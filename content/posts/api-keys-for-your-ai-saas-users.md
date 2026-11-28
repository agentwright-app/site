---
title: "Give your AI SaaS users their own API keys: generate, hash, scope and meter them in Postgres"
description: "How to let customers call your AI agent from their own code: key format with a prefix, storing only a SHA-256 hash, showing the key once, scopes, last-used tracking, revocation, and running API requests through the same rate limits and usage metering as the web app."
date: 2026-12-16
slug: api-keys-for-your-ai-saas-users
tags: [postgres, security, nextjs, api]
---

<p class="lede">Sooner or later a customer asks: "Can I call this from my own script?" The answer is an API key per user. Done carelessly, it becomes a second front door that skips your rate limits, your plan caps and your logs. Done right, it is a small table, a hash function and one middleware. This post builds the right version.</p>

## The shape of a good key

A key that is easy to recognise is easier to protect. Use a fixed prefix, a short public id and a long random secret:

```
aw_live_k7Q2mX9p_4fJ8sLw0cRt3vYbN6eHq1uZaD5gKoPi
└──┬──┘ └──┬───┘ └──────────────┬───────────────┘
 prefix  key id         secret (32 random bytes, base62)
```

- **The prefix** (`aw_live_`) lets secret scanners such as GitHub's find leaked keys, and tells a human at a glance what the string is.
- **The key id** is stored in plain text and shown in your dashboard ("aw_live_k7Q2mX9p…"), so users can tell keys apart.
- **The secret** has enough entropy (32 random bytes) that hashing it with a fast hash is safe; there is nothing to brute-force.

```ts
import { randomBytes, createHash } from "node:crypto";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const base62 = (buf: Buffer) => [...buf].map((b) => B62[b % 62]).join("");

export function newApiKey() {
  const id = base62(randomBytes(8));
  const secret = base62(randomBytes(32));
  const key = `aw_live_${id}_${secret}`;
  return { id, key, hash: sha256(key) };
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
```

(`b % 62` has a tiny bias; with 32 bytes it does not matter for security. Use rejection sampling if you want it exact.)

## Store the hash, show the key once

```sql
CREATE TABLE api_keys (
  id           text PRIMARY KEY,                 -- the public key id
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,                    -- "CI pipeline", "Zapier"
  key_hash     text NOT NULL UNIQUE,             -- sha256 of the full key
  scopes       text[] NOT NULL DEFAULT '{agent:run}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX api_keys_user ON api_keys (user_id) WHERE revoked_at IS NULL;
```

The full key exists in exactly one place: the response to the "Create key" request. Show it once with a copy button and the sentence "You won't see this again." If the database leaks, the hashes are useless to an attacker. Passwords need slow hashes like Argon2 because people choose weak ones; random 32-byte secrets do not, and a fast SHA-256 keeps every API request cheap to check.

Cap the number of active keys per user (10 is plenty) so a bug in someone's script cannot create thousands.

## Check the key on every request

```ts
export async function authFromApiKey(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith("aw_live_")) return null;

  const row = await db.query.apiKeys.findFirst({
    where: (k, { and, eq, isNull }) => and(eq(k.keyHash, sha256(key)), isNull(k.revokedAt)),
  });
  if (!row) return null;

  // Write last_used_at at most once a minute per key, not on every request.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  }
  return { userId: row.userId, keyId: row.id, scopes: row.scopes };
}
```

Look the key up by its hash, which is indexed and unique, rather than by id plus a comparison; there is no timing leak in a hash lookup worth worrying about at this entropy. Return the same `401` for "malformed", "unknown" and "revoked", so the response tells an attacker nothing.

## Same limits as the web app

This is the part that is easy to forget. An API request must take the same path as a request from your chat UI: the same per-user rate limit, the same monthly cap, the same usage row. The simplest way to guarantee it is to resolve both kinds of authentication to one `userId` and call one function:

```ts
export async function POST(req: Request) {
  const auth = (await authFromApiKey(req)) ?? (await sessionAuth(req));
  if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
  if ("scopes" in auth && !auth.scopes.includes("agent:run"))
    return Response.json({ error: "forbidden" }, { status: 403 });

  return handleAgentRequest({ userId: auth.userId, keyId: "keyId" in auth ? auth.keyId : null, req });
}
```

Inside `handleAgentRequest` sit the [rate limit](/blog/rate-limit-llm-endpoints-postgres/), the [spend limit](/blog/per-user-spend-limits-in-dollars/) and the metered agent loop. Add a nullable `api_key_id` column to your usage table so users can see which key spent what; that is the first question they ask when a bill looks high.

API callers retry more aggressively than humans click. Accept an `Idempotency-Key` header and treat it as the [double-submit post](/blog/idempotent-agent-requests-double-submit/) describes, so a retried request does not pay for a second agent run.

## Scopes: start with two

Resist designing a permission system on day one. Two scopes cover most products:

- `agent:run`: call the agent.
- `data:read`: read conversations and usage.

Add more when a customer asks for a narrower key, not before. Store them as a text array so adding one is not a migration.

## Revocation and rotation

Revoking sets `revoked_at`; the next request with that key fails. Never delete the row: usage rows point at it, and "which key was this?" should still have an answer a year later. Rotation is "create a new key, update the script, revoke the old one", so let a user hold two active keys at once.

When GitHub's secret scanning or a user reports a leak, revoke first and email the owner second. If you register your prefix with secret scanning partners later, that path can be automatic.

## The dashboard page

One small page in your settings: name, key id, scopes, created, last used, and a Revoke button per key. "Last used: never" next to a three-month-old key is a hint to clean up. Showing usage per key from the usage table answers the bill question before it becomes a support email.

## Summary

- Keys look like `prefix_id_secret`: scannable, identifiable, 32 random bytes of secret.
- Store only a SHA-256 hash; show the full key once.
- Resolve API keys and browser sessions to the same `userId` and run both through the same limits, caps and metering.
- Two scopes, revoke by timestamp, never delete, allow two active keys for rotation.
- Record the key id on each usage row so users can see what each key spent.

<!-- site-only -->

*Agentwright Starter does not include user API keys; its agent route signs users in with Auth.js and runs every request through the rate limit, the monthly cap and usage metering, which is the path an API key from this post should join. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
