---
title: "Claude API errors in an agent loop: what to retry, what to surface, and what never to run twice"
description: "Which Claude API errors are retryable (429, 500, 529, connection), what the TypeScript SDK already retries for you, why a failure mid-stream needs its own handling, and how to retry the model call without re-running a tool that already charged a card."
date: 2026-11-13
slug: claude-api-errors-retries-agent-loop
tags: [claude, agents, typescript, reliability]
---

<p class="lede">A single chat completion that fails is easy: show an error, let the user press the button again. An agent is different. By the time turn four fails, turns one to three have already called your tools, and some of those tools wrote to a database or sent an email. Retrying "the request" is no longer a well-defined thing. This post sorts Claude API errors into the ones you retry, the ones you show, and the ones that mean your code is wrong, then shows where the retry belongs in an agent loop.</p>

Error types and SDK behaviour below were checked against Anthropic's API error documentation and the `@anthropic-ai/sdk` TypeScript SDK on 2026-11-05.

## The errors, sorted by what you do about them

| Status | Type | Retry? | What it usually means |
|---|---|---|---|
| 400 | `invalid_request_error` | No | Your request is wrong: bad parameter, wrong message order, a field this model does not accept |
| 401 | `authentication_error` | No | Missing, revoked or wrong API key |
| 403 | `permission_error` | No | This key or workspace may not do this |
| 404 | `not_found_error` | No | Typo in the model id, or a model your organization cannot use |
| 413 | `request_too_large` | No | The request body is over the size limit |
| 429 | `rate_limit_error` | Yes, after `retry-after` | You hit requests or tokens per minute |
| 500 | `api_error` | Yes, with backoff | Something failed on Anthropic's side |
| 529 | `overloaded_error` | Yes, with backoff | The API is temporarily overloaded |

Plus one that is not an HTTP status at all: a **connection error** (DNS, TLS, reset, timeout) where no response arrived. Treat it like a 5xx.

The rule of thumb: **4xx means change the request, 429 and 5xx mean wait and try the same request again.** The one 4xx that deserves a second look is 400, because on newer models it is often a parameter that an older model accepted. Sending `temperature` to Claude Opus 5.5 or `thinking: { type: "disabled" }` to Claude Sonnet 5.5 is a 400, and no amount of retrying fixes it. Log the full message; it usually names the field.

## What the SDK already does for you

The official TypeScript SDK retries **408, 409, 429, 5xx and connection errors** automatically, **2 times by default**, with exponential backoff, and it respects the `retry-after` header. The default timeout is 10 minutes (TypeScript takes milliseconds).

So the first piece of advice is negative: **do not wrap every call in your own retry loop on top of the SDK's.** Three SDK retries inside each of your three retries is up to nine requests for one user message, which is how a short overload turns into a burst of traffic from your app. Adjust the SDK instead:

```ts
import Anthropic from "@anthropic-ai/sdk";

// One client for the app. Chat routes want to fail fast; a user is waiting.
export const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });

// Background jobs can be more patient, per request:
await client.messages.create(params, { maxRetries: 5, timeout: 600_000 });
```

Note that timeouts are retried too, so wall-clock time can reach `timeout × (maxRetries + 1)`. Pick the timeout for the route, not for the API.

## Catch errors most specific first

When the SDK gives up, it throws a typed error. Use the classes, not string matching on the message:

```ts
function classify(e: unknown): "retry-later" | "user" | "bug" | "unknown" {
  // APIConnectionError extends APIError in the TypeScript SDK, so check it first.
  if (e instanceof Anthropic.APIConnectionError) return "retry-later";
  if (e instanceof Anthropic.RateLimitError) return "retry-later";       // 429
  if (e instanceof Anthropic.InternalServerError) return "retry-later";  // >= 500, includes 529
  if (e instanceof Anthropic.BadRequestError) return "bug";              // 400
  if (e instanceof Anthropic.AuthenticationError) return "bug";          // 401
  if (e instanceof Anthropic.PermissionDeniedError) return "bug";        // 403
  if (e instanceof Anthropic.NotFoundError) return "bug";                // 404
  if (e instanceof Anthropic.APIError) return "unknown";
  return "unknown";
}
```

"Bug" here means *page yourself, not the user*. A 401 in production is a rotated key; a 404 is a model id typo in a deploy. The user should see a short "something went wrong on our side" and you should get an alert, because every request will fail the same way until someone fixes the configuration.

"Retry later" means the SDK already retried and it still failed. Tell the user plainly that the AI service is busy and the message was not lost, and keep their input in the text box.

## The hard part: a failure in the middle of a stream

An agent route almost always streams. Streams fail in a way plain requests do not: the HTTP response is a 200, text has already reached the browser, and then an error event arrives in the stream, or the connection drops.

The SDK's automatic retry covers a request that failed **before** a response started. Once a stream is under way, an error is thrown to your code from the stream (for example from `finalMessage()`). You decide what happens, and there are two reasonable choices:

1. **Throw away the partial turn and retry it.** Tell the client to discard what it showed for this turn (an SSE event like `turn_reset` works), then send the same request again. The conversation history has not changed, because you only append an assistant message after `finalMessage()` resolves.
2. **Stop and show what you have**, marked as incomplete. Better for long answers where the user can read the first half.

Whatever you choose, never append a half-finished assistant message to the stored history. A partial `tool_use` block in particular has incomplete input; running it is a bug.

## Where the retry belongs in an agent loop

An agent loop alternates two kinds of work: **model calls**, which are safe to repeat, and **tool calls**, which may not be. The retry has to sit around the model call only:

```ts
for (let turn = 0; turn < MAX_TURNS; turn++) {
  const final = await callModelWithRetry({ model, system, tools, messages }); // safe to repeat
  messages.push({ role: "assistant", content: final.content });
  if (final.stop_reason !== "tool_use") return messages;

  const results = await runToolsOnce(final.content);  // never inside a retry
  messages.push({ role: "user", content: results });
  await saveCheckpoint(conversationId, messages);     // persist after every completed turn
}
```

Two things make this work:

- **Checkpoint after every completed turn.** If turn four fails for good, you still have turns one to three, including the tool results. When the user retries, you continue from the checkpoint and the model sees that `create_invoice` already ran and what it returned. It will not call it again.
- **Give side-effect tools an idempotency key.** Use the `tool_use` block's `id` as the key when a tool writes somewhere: `INSERT ... ON CONFLICT (tool_use_id) DO NOTHING`, or pass it as the idempotency key to a payment API. If anything does run twice, the second run is a no-op.

For a tool that fails, do not throw out of the loop. Return a `tool_result` with `is_error: true` and a short message. The model can usually recover (retry with different input, try another tool, or explain the problem to the user), and you keep one conversation instead of an exception.

## Do not meter what you did not get

A request that ends in an error status returns no `usage`, so there is nothing to record. A stream that fails halfway is the edge case: you have no final usage object, and an estimate is a guess. The simple, honest rule is to record usage only from a completed `finalMessage()`, and to count failed attempts separately (a `failed_requests` counter per model is enough) so a rising error rate shows up on a dashboard before users report it.

## Fallbacks when one model is overloaded

If 529s cluster on one model, the API is telling you that model is busy, not that your request is bad. For chat you can fall back to a different model for that one turn. Two cautions: prompt caches are per model, so the fallback request pays full input price; and some features and parameters differ between models, so test the fallback path with your evals rather than discovering a 400 during an incident. Our post on [evals for Claude agents](/blog/evals-for-claude-agents-typescript/) shows a runner that makes that a one-line check.

## Summary

- 4xx: change the request (400, 401, 403, 404, 413). Alert yourself; show the user a short message.
- 429, 5xx (including 529) and connection errors: retry with backoff. The SDK already does this twice by default.
- Do not stack your own retry loop on top of the SDK's.
- A failure mid-stream is yours to handle: discard or keep the partial turn, never store it as finished.
- Retry model calls, never tool calls. Checkpoint each completed turn and use the `tool_use` id as an idempotency key.

<!-- site-only -->

*Agentwright Starter's agent loop appends to history only after a turn completes, returns tool failures as `is_error` results instead of throwing, and records usage only from completed responses. It launches in December 2026; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's API error documentation and the TypeScript SDK before publishing.*

<!-- /site-only -->
