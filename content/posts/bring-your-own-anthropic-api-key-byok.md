---
title: "Bring your own key (BYOK) for an AI SaaS: let users plug in their Anthropic API key safely"
description: "When BYOK makes sense for a Claude-based product, how to encrypt user API keys at rest with AES-256-GCM, validate a key before saving it, use it per request without logging it, keep metering and rate limits on, and price a BYOK plan."
date: 2026-12-17
slug: bring-your-own-anthropic-api-key-byok
tags: [security, ai, postgres, saas]
---

<p class="lede">Some customers would rather pay Anthropic directly: a company with its own committed spend, a power user who runs your agent all day, a team that wants model usage on its own invoice. "Bring your own key" lets them paste an Anthropic API key into your settings page, and your app uses it for their requests. It changes your margin, your security duties and your support load. Here is how to build it without regretting it.</p>

## Should you offer it at all?

BYOK is a good fit when model cost is the largest part of a heavy user's bill and you would otherwise have to price them out. It is a poor fit when your value is a polished, predictable product: once the customer's key is in play, their rate limits, their billing problems and their model access become your support tickets.

A common shape: normal plans use your key and include usage; one "BYOK" plan costs less per month, includes no model usage, and uses the customer's key for everything. Do not mix keys inside one plan; "which key paid for this run?" should always have one answer.

## Encrypt at rest with AES-256-GCM

A user's API key is a secret you must be able to read back, so it is encrypted, not hashed (the opposite of the [API keys you issue](/blog/api-keys-for-your-ai-saas-users/)). Node's built-in crypto is enough:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEK = Buffer.from(process.env.BYOK_ENCRYPTION_KEY!, "base64"); // 32 bytes, never in the database
if (KEK.length !== 32) throw new Error("BYOK_ENCRYPTION_KEY must be 32 bytes, base64");

export function encryptSecret(plain: string, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEK, iv);
  cipher.setAAD(Buffer.from(userId));             // binds the ciphertext to this user
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), data: data.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function decryptSecret(box: { iv: string; data: string; tag: string }, userId: string) {
  const decipher = createDecipheriv("aes-256-gcm", KEK, Buffer.from(box.iv, "base64"));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8");
}
```

Three details carry the weight:

- **A fresh 12-byte IV per encryption.** Reusing an IV with the same key breaks GCM.
- **The user id as additional authenticated data.** If someone copies user A's ciphertext into user B's row, decryption fails instead of handing B's requests A's key.
- **The encryption key lives outside the database**, in an environment variable or a key management service. A stolen database dump alone is then useless.

Store the three base64 strings, plus the last four characters of the key for display ("sk-ant-…a1b2") and a `key_version` column so you can rotate the encryption key later by re-encrypting rows.

## Validate before saving

A pasted key may be wrong, revoked, or from an account without access to the model you use. Test it once with a tiny request before storing it:

```ts
import Anthropic from "@anthropic-ai/sdk";

export async function checkUserKey(apiKey: string) {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  try {
    await client.messages.countTokens({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true as const };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false as const, reason: "This key was not accepted." };
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false as const, reason: "This key cannot use the model." };
    if (e instanceof Anthropic.NotFoundError) return { ok: false as const, reason: "The model is not available for this key." };
    throw e;
  }
}
```

[Token counting](/blog/count-tokens-before-sending-claude/) is free, so the check costs the customer nothing. Re-check when requests start failing with 401: keys get revoked, and the right response is a banner ("Your Anthropic key stopped working"), not a stream of 500s.

## Use it per request, never log it

Create the client per request with the decrypted key and let it go out of scope:

```ts
const apiKey = decryptSecret(row.box, userId);
const client = new Anthropic({ apiKey });
```

Then audit the places a key can leak: error trackers that capture request headers, debug logs that print the client config, traces that store the request. Redact the `x-api-key` header in every logger, and add a test that throws an error inside a BYOK request and checks the captured event has no `sk-ant-` string in it.

## Keep metering and limits on

It is tempting to skip metering for BYOK users, since you are not paying. Keep it. You still want:

- **Usage rows**, so the user can see their spend in your dashboard and your support can answer "why was my Anthropic bill high this week?"
- **Rate limits**, because a BYOK user's runaway script still uses your servers, your database and your tool APIs.
- **Turn and token limits**, so a loop bug does not burn the customer's money. They will blame you, fairly.

Mark the usage rows with `billed_to = 'customer_key'` so your own cost reports leave them out.

## Errors the customer must see

With your own key, a 429 is your capacity problem and you retry quietly. With their key, a 429 or a "credit balance too low" error belongs to the customer, and hiding it behind a generic "Something went wrong" generates tickets. Map the Anthropic error to a plain message that says whose limit was hit and where to fix it.

## Pricing a BYOK plan

Price the product, not the tokens. A BYOK plan typically costs less than the cheapest plan that includes usage, and more than zero, because your hosting, tools, storage and support still cost money. Run the numbers with your [plan margin](/blog/price-ai-saas-plan-margins/) sheet: on a BYOK plan the model line is zero and the rest stays.

## Summary

- Offer BYOK as its own plan; one plan, one key, no mixing.
- Encrypt with AES-256-GCM, a random IV, the user id as AAD, and an encryption key outside the database.
- Validate with a free token count before saving; re-check on 401s.
- Create the client per request, redact keys in every log and error tracker, and test that redaction.
- Keep usage rows, rate limits and turn caps for BYOK users, and show them their own errors plainly.

<!-- site-only -->

*Agentwright Starter does not include BYOK: it calls Claude with one server-side key from the environment and meters every call per user, which is the metering a BYOK plan should keep. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
