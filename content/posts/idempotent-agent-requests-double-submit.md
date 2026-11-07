---
title: "One click, one agent run: idempotency keys for an AI chat endpoint"
description: "Why double clicks, mobile retries and reconnecting streams start the same Claude agent run twice, and how to stop it with a client-generated idempotency key, a unique constraint in Postgres, and a reattach path that replays the stored answer instead of paying for a second run."
date: 2026-12-10
slug: idempotent-agent-requests-double-submit
tags: [postgres, nextjs, typescript, reliability]
---

<p class="lede">An agent run is expensive and can have side effects: it calls Claude several times, may call tools that send email or write records, and takes long enough that users get impatient. So the same message gets sent twice more often than you would think: a double click, a phone that retries a request after a network switch, a browser that reconnects a dropped stream by posting again. Each duplicate is a second bill and possibly a second email. The fix is old and boring: an idempotency key.</p>

## Where duplicates come from

- **Double submit.** The user presses Enter, then clicks Send. Disabling the button helps, but only in the browser that has your latest JavaScript.
- **Client retries.** Mobile networks drop connections. Fetch wrappers, service workers and some proxies retry a POST that looked like it failed, even though the server received it and started working.
- **Stream reconnects.** A [streaming](/blog/stream-claude-agent-sse-nextjs/) response breaks after 40 seconds. Your client's reconnect logic posts the message again to get the rest, which starts a new run instead.
- **Your own queue.** A [background job](/blog/background-agent-jobs-postgres-skip-locked/) worker crashes after starting the run and the job is picked up again.

The first three are the request path, and one mechanism covers all of them.

## Step 1: the client makes the key

When the user sends a message, the browser generates a key once and reuses it for every attempt of that message:

```ts
async function sendMessage(conversationId: string, text: string) {
  const key = crypto.randomUUID();           // one per user message, not per attempt
  pendingKeys.set(text, key);
  return fetchWithRetry(`/api/agent`, {
    method: "POST",
    headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, text }),
  });
}
```

The key must survive a retry. If the retry generates a new key, it protects nothing. Store it with the pending message in component state (or `sessionStorage` if you want it to survive a page reload).

## Step 2: the database refuses the second run

Give the runs table a unique constraint on the user and the key:

```sql
ALTER TABLE agent_runs ADD COLUMN idempotency_key text;
ALTER TABLE agent_runs ADD COLUMN request_hash text;
CREATE UNIQUE INDEX agent_runs_idem_idx ON agent_runs (user_id, idempotency_key);
```

Scoping by `user_id` matters: keys come from clients, so two users must never collide or see each other's runs.

On each request, try to create the run first, before calling Claude:

```ts
const hash = sha256(JSON.stringify({ conversationId, text }));

const inserted = await db.query(
  `INSERT INTO agent_runs (user_id, conversation_id, route, idempotency_key, request_hash)
   VALUES ($1, $2, 'chat', $3, $4)
   ON CONFLICT (user_id, idempotency_key) DO NOTHING
   RETURNING id`,
  [userId, conversationId, key, hash]
);

if (inserted.rows.length === 1) {
  return startRun(inserted.rows[0].id);     // first attempt: do the work
}

const existing = await db.query(
  `SELECT id, status, request_hash FROM agent_runs
   WHERE user_id = $1 AND idempotency_key = $2`,
  [userId, key]
);
const run = existing.rows[0];
if (run.request_hash !== hash) {
  return json({ error: "This idempotency key was used for a different message." }, 422);
}
return reattach(run);                        // duplicate: no new run
```

`ON CONFLICT DO NOTHING` makes the check and the insert one atomic step, so two requests arriving in the same millisecond cannot both start a run. A "check if it exists, then insert" in application code has exactly that race.

The hash check catches a client bug that reuses a key for a different message. Refuse it rather than silently returning the answer to another question.

## Step 3: reattach instead of rerun

A duplicate request finds the run in one of three states:

- **`ok`, `error` or `cancelled`:** the run finished. Return the stored result: the assistant's message from your [conversation store](/blog/store-agent-conversations-append-only/), or the error. No Claude call.
- **`running`:** the first request is still working. Either return `409` with the run id and let the client poll or subscribe, or stream the events that run is producing. If you write each streamed event to the database or a pub/sub channel with a sequence number, the duplicate can replay what happened so far and follow the rest. The client sends the last sequence number it saw, so a reconnect resumes without duplicating text.
- **Stale `running`:** the process that owned it died. Mark runs `running` for longer than your maximum run time as `error`, from a cleanup job, so users can try again with a new message.

The simplest version that still saves money: for a running duplicate, return `409 { runId }` and have the client show "Still working on your last message" and fetch the result when it is done.

## Step 4: protect the side effects too

Idempotency at the entrance stops duplicate runs. It does not stop a single run from calling the same tool twice, for example when the model retries after an ambiguous tool result. For tools with side effects, derive a key from the run and the tool call:

```ts
const effectKey = `${runId}:${toolUseId}`;
await db.query(
  `INSERT INTO tool_effects (key, kind, result) VALUES ($1, 'send_email', NULL)
   ON CONFLICT (key) DO NOTHING RETURNING key`, [effectKey]
);
```

If the insert returns no row, the effect already happened; return the stored result to the model instead of sending again. Many APIs you call from tools (payment providers, some email services) accept an idempotency key header themselves; pass `effectKey` through. The [errors and retries post](/blog/claude-api-errors-retries-agent-loop/) covers which calls are never safe to repeat blindly.

## How long to keep keys

Keys only need to outlive realistic retries. Keep them for 24 hours to a few days, then null out `idempotency_key` on old runs from a nightly job, or leave them: the unique index on `(user_id, idempotency_key)` costs little at SaaS scale.

## Testing it

Two tests catch most regressions:

1. Send the same request twice concurrently with the same key; assert exactly one run row and one call to your (faked) model client. The [testing post](/blog/test-agent-tools-without-calling-claude/) shows how to fake the model.
2. Send the same key with a different body; assert a 422 and no run.

## Summary

- Duplicates come from double clicks, client retries and stream reconnects; they cost money and repeat side effects.
- The client generates one key per user message and reuses it on every retry.
- A unique index on `(user_id, idempotency_key)` with `INSERT ... ON CONFLICT DO NOTHING` decides atomically which request does the work.
- Duplicates reattach: return the stored result or follow the running run; never start another.
- Key tool side effects by run and tool call id, and pass the key on to external APIs.

<!-- site-only -->

*Agentwright Starter's agent API streams runs over SSE and records usage per model call, the two places where these keys plug in. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
