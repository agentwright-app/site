---
title: "A Stop button for your Claude agent: cancel the stream, the tools and the bill with AbortController"
description: "How to let users stop a running AI agent in a Next.js app: abort the fetch in the browser, pass request.signal to the Anthropic SDK and to your tools, leave the conversation in a valid state, and still record the tokens you paid for when a stream ends early."
date: 2026-12-02
slug: cancel-claude-agent-runs-abortcontroller
tags: [nextjs, typescript, claude, webdev]
---

<p class="lede">Users press Stop for good reasons: the agent misunderstood the question, it is calling the same tool for the third time, or they simply saw the answer they needed. If Stop only hides the output while the server keeps going, you keep paying for tokens nobody reads, tools keep running, and the conversation ends up in a half-finished state. This post wires Stop through every layer of a Next.js agent app.</p>

The SDK behaviour below follows the Anthropic TypeScript SDK documentation, checked on 2026-11-06. The route builds on the one from [streaming a Claude agent over SSE](/blog/stream-claude-agent-sse-nextjs/).

## One signal, passed all the way down

The web platform already has the tool for this: an `AbortController` creates a signal, and anything that accepts the signal stops when it fires. The plan:

1. The browser aborts its `fetch` when the user presses Stop.
2. The server sees the disconnect as `request.signal` firing.
3. That same signal goes to the Anthropic SDK call and to every tool.

## Step 1: the browser

```ts
const controllerRef = useRef<AbortController | null>(null);

async function send(text: string) {
  const controller = new AbortController();
  controllerRef.current = controller;
  setRunning(true);
  try {
    const res = await fetch("/api/agent", {
      method: "POST", body: JSON.stringify({ conversationId, text }), signal: controller.signal,
    });
    await readEvents(res.body!, onEvent);
  } catch (err) {
    if ((err as Error).name !== "AbortError") throw err;   // Stop is not an error for the user
  } finally {
    setRunning(false);
  }
}

const stop = () => controllerRef.current?.abort();
```

Show the text that arrived before Stop, marked as stopped, rather than removing it. Users often press Stop because they already have what they need.

## Step 2: the server sees it

In a Next.js route handler, `request.signal` aborts when the client disconnects. Pass it into the agent loop:

```ts
export async function POST(req: Request) {
  const user = await requireUser();
  const body = await req.json();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await runAgent({ userId: user.id, ...body, signal: req.signal, emit: (e) => controller.enqueue(sse(e)) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}
```

How quickly the abort reaches your code depends on the host and on proxies in between, so treat it as best effort. For a hard guarantee, also give the run an ID and add a small `POST /api/agent/:runId/stop` endpoint that sets a flag the loop checks between turns. The client calls it and then aborts its fetch.

## Step 3: the model call

The SDK accepts a `signal` in the request options. When it fires, the HTTP request to the API is cancelled and the stream stops:

```ts
const stream = client.messages.stream(
  { model, max_tokens: 4096, system, tools, messages },
  { signal },
);
```

Cancelling stops you from waiting for (and paying for) more output, but a request that already started has used tokens. The safe assumption is that the input tokens of every started request, and the output you received, are billed. That is why the next step matters.

## Step 4: record what you paid for

A normal turn ends with a final message and its `usage`. A cancelled turn does not. You still have partial information from the stream:

- The `message_start` event carries `usage.input_tokens` (and cache read and write counts) for the request.
- `message_delta` events carry cumulative `usage.output_tokens`, but they come near the end, so a stream cancelled early may not have one.

Keep the latest numbers as events arrive, and write a usage row in a `finally` block whether the turn completed or not:

```ts
let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
let streamedChars = 0;
let complete = false;

stream.on("streamEvent", (e) => {
  if (e.type === "message_start") usage = { ...usage, ...e.message.usage };
  if (e.type === "message_delta") usage.output_tokens = e.usage.output_tokens;
});
stream.on("text", (t) => { streamedChars += t.length; emit({ type: "text", text: t }); });

try {
  await stream.finalMessage();
  complete = true;
} finally {
  const estimated = !complete && usage.output_tokens === 0;
  if (estimated) usage.output_tokens = Math.ceil(streamedChars / 4);   // rough: ~4 characters per token in English
  await recordUsage(userId, model, usage, { estimated, cancelled: !complete });
}
```

Mark estimated rows. The point is not cent-level accuracy on one request, it is that cancelled turns still count against the user's [spend limit](/blog/per-user-spend-limits-in-dollars/). Otherwise "start, cancel, repeat" is a way around it. Once a month, compare your recorded total with the Anthropic Console's usage page to see how far off the estimates are.

## Step 5: tools

Pass the signal to every tool, and from there to every `fetch` and database call that accepts one:

```ts
async function runTools(calls: Anthropic.ToolUseBlock[], ctx: Ctx & { signal: AbortSignal }) {
  ctx.signal.throwIfAborted();
  return Promise.all(calls.map((c) => tools[c.name].run(c.input, ctx)));
}

const fetchPage = async ({ url }: { url: string }, ctx: Ctx) =>
  (await fetch(url, { signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15_000)]) })).text();
```

`AbortSignal.any` combines the user's Stop with a per-tool timeout, so a slow website cannot hold the loop either.

Be careful with tools that change things. Aborting a refund or an email halfway can leave you not knowing whether it happened. For those, ignore the signal once the action has started, let it finish, and record the result. The check belongs before the action starts, not in the middle. Actions like that should also go through an [approval step](/blog/approval-gates-for-agent-tool-calls/).

## Step 6: leave the conversation valid

The Messages API requires every `tool_use` block to be followed by a matching `tool_result`. If you saved an assistant message with tool calls and the user stopped before the results came back, the next request in that conversation fails. Two options:

- **Do not save** an assistant message until its turn is complete. Simple, but the user loses the partial text.
- **Save and close it.** Save the partial assistant text, and for any tool call without a result, save a `tool_result` with `is_error: true` and the text "Stopped by the user before this tool ran." The model then understands what happened if the user continues.

We prefer the second. The conversation stays readable, and with [append-only storage](/blog/store-agent-conversations-append-only/) the stop is part of the history, not a gap.

If the stream was cut off in the middle of a `tool_use` block, its input JSON is incomplete. Drop that block rather than saving broken input.

## Test it

Stop is easy to break and hard to notice. Three checks:

- Start a long answer, press Stop, and confirm in your server logs that the API request ended within a second or two.
- Press Stop during a tool call and send a follow-up message. It must not fail with a `tool_use` / `tool_result` error.
- Press Stop right after sending, and check that a usage row exists with `cancelled = true`.

## Summary

- One `AbortSignal` from the browser's Stop button reaches the SDK call and every tool.
- Pass `{ signal }` as the second argument to `client.messages.stream()`; add a stop endpoint if your host does not reliably report disconnects.
- Record usage in `finally`: input from `message_start`, output from the last `message_delta`, or an estimate marked as such.
- Combine the user's signal with per-tool timeouts; don't abort side-effecting actions once started.
- Close interrupted turns with error `tool_result` blocks so the conversation can continue.

<!-- site-only -->

*Agentwright Starter passes the request's abort signal from its streaming agent route into the Claude API call. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against the Anthropic TypeScript SDK documentation before publishing.*

<!-- /site-only -->
