---
title: "Stream a tool-using Claude agent to the browser with SSE in Next.js"
description: "A typed server-sent events protocol for an agent that calls tools: a Next.js route handler that streams text, tool calls, tool results and usage, a 30-line client parser over fetch(), cancellation, and the headers that stop proxies from buffering."
date: 2026-11-06
slug: stream-claude-agent-sse-nextjs
tags: [claude, nextjs, streaming, typescript]
---

<p class="lede">Streaming a chat answer token by token is the easy part. An agent also pauses to call tools, sometimes several in parallel, runs for many seconds, and costs money on every turn. This post shows a small event protocol that carries all of that from a Next.js route handler to a React client, and the handful of details that make it work behind real proxies.</p>

The code uses the official `@anthropic-ai/sdk`, the Next.js 15 App Router and no streaming library on either side. Server-sent events are just lines of text, so you can read every byte that crosses the wire.

## Why SSE, and why not `EventSource`

Server-sent events (SSE) are a one-way stream over a normal HTTP response with `Content-Type: text/event-stream`. Each message is a few `field: value` lines followed by a blank line:

```
event: text
data: {"delta":"Hello"}

```

For an agent that fits well: the client sends one request, the server pushes many events, and nothing needs to go the other way mid-run. WebSockets would add a connection upgrade and a second protocol for no benefit.

The browser's built-in `EventSource` only does `GET` requests and cannot set a request body or an `Authorization` header. A chat message belongs in a `POST` body, so the client below uses `fetch()` and parses the stream itself. That is about 30 lines.

## The protocol: name every event

Decide up front what the client can receive. A discriminated union keeps the server and client honest:

```ts
export type AgentEvent =
  | { event: "meta"; data: { conversationId: string } }
  | { event: "text"; data: { delta: string } }
  | { event: "tool_call"; data: { name: string; input: unknown } }
  | { event: "tool_result"; data: { name: string; result: unknown; isError: boolean } }
  | { event: "usage"; data: { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number } }
  | { event: "error"; data: { code: string; message: string } }
  | { event: "done"; data: Record<string, never> };

const sse = (ev: AgentEvent) => `event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`;
```

Each event exists for a reason the UI cares about:

- `meta` arrives first so the client knows the conversation id before any text, even if the run fails later.
- `tool_call` and `tool_result` let you show "Looking up order 1042…" instead of a frozen spinner during a slow tool.
- `usage` is sent after every model turn, so a usage meter can move while the agent works.
- `error` carries a machine-readable `code` (rate limited, plan cap reached, model refused) so the client can show the right message instead of a stack trace.
- `done` is an explicit end. Without it, a dropped connection and a finished answer look the same.

`JSON.stringify` never emits a raw newline, so one `data:` line per event is always valid SSE.

## The agent loop with callbacks

The loop is the standard tool-use cycle: call the model, run any tools it asked for, send the results back, repeat until it stops asking. The only addition is a callback at each point the client wants to hear about:

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function runAgent(opts: {
  system: string;
  messages: Anthropic.MessageParam[];
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onToolCall?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, result: unknown, isError: boolean) => void;
  onTurn?: (m: Anthropic.Message) => void;
}) {
  const messages = [...opts.messages];
  for (let turn = 0; turn < 12; turn++) {
    const stream = client.messages.stream(
      { model: "claude-sonnet-5-5", max_tokens: 8192, system: opts.system, tools, messages },
      { signal: opts.signal },
    );
    stream.on("text", (t) => opts.onText?.(t));
    const final = await stream.finalMessage();
    opts.onTurn?.(final);
    messages.push({ role: "assistant", content: final.content });
    if (final.stop_reason !== "tool_use") return messages;

    const calls = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.ToolResultBlockParam> => {
        opts.onToolCall?.(call.name, call.input);
        try {
          const result = await runTool(call.name, call.input);
          opts.onToolResult?.(call.name, result, false);
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) };
        } catch (e) {
          opts.onToolResult?.(call.name, (e as Error).message, true);
          return { type: "tool_result", tool_use_id: call.id, content: `Tool error: ${(e as Error).message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  throw new Error("Agent exceeded 12 turns");
}
```

Two things worth copying even if your loop looks different. All tool results from one turn go back in **one** user message; splitting them across messages makes Claude stop calling tools in parallel. And a failed tool returns a `tool_result` with `is_error: true` rather than throwing, so the model can read the error and try something else.

`stream.on("text")` fires for text deltas only. Tool inputs arrive complete in `finalMessage()`, which is all the UI needs for a "calling tool X" line.

## The route handler

The handler authenticates, then returns a `ReadableStream` that runs the loop and writes events as they happen:

```ts
// app/api/agent/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { message, history } = await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AgentEvent) => controller.enqueue(encoder.encode(sse(ev)));
      try {
        await runAgent({
          system: SYSTEM_PROMPT,
          messages: [...history, { role: "user", content: message }],
          signal: req.signal,
          onText: (delta) => send({ event: "text", data: { delta } }),
          onToolCall: (name, input) => send({ event: "tool_call", data: { name, input } }),
          onToolResult: (name, result, isError) => send({ event: "tool_result", data: { name, result, isError } }),
          onTurn: (m) => send({ event: "usage", data: {
            inputTokens: m.usage.input_tokens,
            outputTokens: m.usage.output_tokens,
            cacheRead: m.usage.cache_read_input_tokens ?? 0,
            cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
          } }),
        });
        send({ event: "done", data: {} });
      } catch (e) {
        const err = e as Error & { code?: string };
        send({ event: "error", data: { code: err.code ?? "AGENT_ERROR", message: err.message } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

Things that look optional and are not:

- **Errors that happen before the stream starts are plain JSON responses** with a real status code (401, 429). Once you have returned a 200 with an event stream, the only way to report a failure is an `error` event.
- **`signal: req.signal`** passes the browser's disconnect to the SDK. When the user closes the tab or presses stop, the in-flight model request is cancelled instead of running to `max_tokens` on your bill.
- **`no-transform` and `X-Accel-Buffering: no`** stop compression middleware and nginx-style proxies from buffering the response, which is the usual reason "streaming works locally but arrives all at once in production".
- **`maxDuration`** raises the function time limit on hosts that read it (Vercel does). An agent with a few tool calls can take longer than a default limit.

## The client: parse SSE from `fetch()`

```ts
async function* readSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      yield { event, data: data ? JSON.parse(data) : null };
    }
  }
}
```

The buffer is the whole trick. Network chunks do not line up with events: one `read()` can contain half an event or three of them, so you accumulate text and only cut at the blank line that ends an event. `{ stream: true }` on the decoder keeps a multi-byte character that is split across two chunks intact.

Using it in a component:

```ts
const controller = new AbortController();
const res = await fetch("/api/agent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message, history }),
  signal: controller.signal, // controller.abort() on a "Stop" button
});
if (!res.ok || !res.body) {
  const body = await res.json().catch(() => ({}));
  throw new Error(res.status === 429 ? "Rate limit reached, try again shortly." : body.error ?? `Request failed (${res.status})`);
}
for await (const { event, data } of readSse(res.body)) {
  if (event === "text") appendText(data.delta);
  else if (event === "tool_call") addToolLine(data.name, data.input);
  else if (event === "tool_result") finishToolLine(data.name, data.result, data.isError);
  else if (event === "usage") addUsage(data);
  else if (event === "error") showError(data.message);
}
```

Aborting the client's `fetch` closes the connection, which aborts `req.signal` on the server, which cancels the model request. One button, three layers, no extra code.

## Things to decide for your product

- **Persist after the run, not per event.** Save the final message list when the loop returns. Writing to the database on every text delta adds latency for no benefit.
- **Send tool results to the client selectively.** A tool result can contain data the user should not see in raw form (internal ids, other customers' rows if a tool is too broad). Send a summary, or only the tool name and a status.
- **Keep the protocol versioned in one file.** Both sides import the same `AgentEvent` type, so adding an event is a type error until both handle it.

<!-- site-only -->

*Agentwright Starter ships this route, the loop and a minimal chat UI that renders tool calls, together with auth, metering and Lemon Squeezy billing. It launches in December 2026; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed against the code before publishing.*

<!-- /site-only -->
