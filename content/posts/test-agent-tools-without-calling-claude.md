---
title: "Test a Claude agent without calling Claude: unit tests for tools and a scripted fake for the loop"
description: "Fast, free, deterministic tests for an AI agent in TypeScript: test tool functions as plain code, validate tool inputs, drive the agent loop with a scripted fake Anthropic client to check tool_use / tool_result handling, errors and limits, and keep real-model checks in a separate eval suite."
date: 2026-11-30
slug: test-agent-tools-without-calling-claude
tags: [testing, typescript, ai, claude]
---

<p class="lede">Most of the code in an agent app is not the model. It is tool functions, input validation, the loop that passes tool results back, spend limits, and storage. All of that can be tested the normal way: fast, offline, for free, with the same result every run. This post shows how to split an agent's tests so that only a small part needs the real Claude API, and the rest runs in CI in a few seconds.</p>

The examples use Node's built-in test runner (`node:test`) with `tsx`, but the same structure works with Vitest or Jest. The message shapes follow Anthropic's Messages API and tool use documentation, checked on 2026-11-06.

## Three layers, three kinds of test

| Layer | What can go wrong | How to test |
|---|---|---|
| Tool functions | Wrong query, bad output format, missing permission check | Plain unit tests, no model |
| The loop | Lost `tool_result`, wrong order, no stop on limits, errors not reported back | A scripted fake client |
| Model behaviour | Picks the wrong tool, bad answer | [Evals](/blog/evals-for-claude-agents-typescript/) against the real API |

The first two run on every commit. Evals are slower, cost money and vary between runs, so they run on prompt or model changes, or nightly.

## Layer 1: tools are just functions

Write each tool so that its logic is a normal function with explicit inputs, and the tool definition is a thin wrapper around it:

```ts
// lib/agent/tools/search-orders.ts
export const searchOrdersInput = z.object({
  email: z.string().email(),
  limit: z.number().int().min(1).max(20).default(5),
});

export async function searchOrders(input: z.infer<typeof searchOrdersInput>, ctx: { db: Db; userId: string }) {
  const rows = await ctx.db.select().from(orders)
    .where(and(eq(orders.ownerId, ctx.userId), eq(orders.email, input.email)))
    .limit(input.limit);
  if (rows.length === 0) return `No orders found for ${input.email}.`;
  return rows.map((o) => `${o.id}  ${o.status}  $${(o.totalCents / 100).toFixed(2)}`).join("\n");
}
```

Then test it like any other function:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("searchOrders only returns the caller's orders", async () => {
  const db = await testDb();
  await db.insert(orders).values([
    { id: "o1", ownerId: "u1", email: "a@x.com", status: "paid", totalCents: 9900 },
    { id: "o2", ownerId: "u2", email: "a@x.com", status: "paid", totalCents: 4900 },
  ]);
  const out = await searchOrders({ email: "a@x.com", limit: 5 }, { db, userId: "u1" });
  assert.match(out, /o1/);
  assert.doesNotMatch(out, /o2/);
});

test("searchOrders says so when there is nothing", async () => {
  const out = await searchOrders({ email: "none@x.com", limit: 5 }, { db: await testDb(), userId: "u1" });
  assert.equal(out, "No orders found for none@x.com.");
});
```

The "nothing found" test matters more than it looks. The model reads the tool's output as text; an empty string or `[]` is easy to misread, while a sentence is not.

## Test the input schema too

The model will sometimes send inputs your schema does not allow. Make sure those fail with a message the model can act on, not a stack trace:

```ts
test("invalid input becomes a readable error", async () => {
  const result = await runToolCall({ name: "search_orders", input: { email: "not-an-email", limit: 500 } });
  assert.equal(result.is_error, true);
  assert.match(String(result.content), /email/);
  assert.match(String(result.content), /limit/);
});
```

## Layer 2: a scripted fake client for the loop

The loop's job is mechanical: send messages, read `stop_reason`, run tools, append results, stop at the right time. To test it, inject the client instead of importing a global one, and give the tests a fake that returns pre-written responses in order:

```ts
type Script = Array<Partial<Anthropic.Message> & { content: Anthropic.ContentBlock[] }>;

export function fakeClient(script: Script) {
  const requests: Anthropic.MessageCreateParams[] = [];
  return {
    requests,
    messages: {
      async create(params: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(params));
        const next = script.shift();
        if (!next) throw new Error("fake client: script ran out");
        return {
          id: `msg_${requests.length}`, type: "message", role: "assistant", model: params.model,
          stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 20 }, ...next,
        } as Anthropic.Message;
      },
    },
  };
}
```

`structuredClone` records each request as it was sent, so later changes to the `messages` array do not rewrite history in your assertions. If your loop streams, give the fake a `stream()` method that returns an object with the same final message; most loop tests only need the final message.

Now a test reads like a conversation:

```ts
test("runs a tool and sends its result back", async () => {
  const client = fakeClient([
    { stop_reason: "tool_use", content: [
      { type: "tool_use", id: "tu_1", name: "search_orders", input: { email: "a@x.com" } },
    ] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "You have one paid order." }] },
  ]);

  const out = await runAgent({ client, userId: "u1", messages: [{ role: "user", content: "my orders?" }] });

  assert.equal(out.text, "You have one paid order.");
  const second = client.requests[1].messages.at(-1)!;
  assert.equal(second.role, "user");
  assert.deepEqual((second.content as any[]).map((b) => [b.type, b.tool_use_id]), [["tool_result", "tu_1"]]);
});
```

## The loop tests worth having

Each of these has caught a real bug for someone:

- **Parallel calls.** Script two `tool_use` blocks in one response; assert that the next request has both `tool_result` blocks in **one** user message, matching both IDs.
- **Tool throws.** Make a tool throw; assert the loop sends a `tool_result` with `is_error: true` and keeps going, instead of crashing the request.
- **Unknown tool.** Script a call to a tool name that does not exist; assert an error result, not an exception.
- **Turn limit.** Script more `tool_use` responses than your maximum turns; assert the loop stops and returns a clear message, and that `requests.length` equals the limit.
- **Spend limit.** Set the user's remaining budget to zero; assert that no request is sent at all (`requests.length === 0`). See [per-user spend limits](/blog/per-user-spend-limits-in-dollars/).
- **Stop reasons.** Script `max_tokens`, `refusal` and `pause_turn`; assert each is handled the way the [stop reasons post](/blog/handle-claude-stop-reasons-agent/) describes.
- **Usage recording.** Assert one usage row per request with the fake's token counts and the model that was sent.

These run in milliseconds because nothing leaves the process.

## What not to fake

Do not try to make the fake "smart" by matching on prompts and returning different answers. That turns your tests into a second, worse model, and they start breaking every time you edit the system prompt. The script is fixed per test, and assertions are about what **your** code did with it.

Also do not snapshot entire requests. A snapshot of the system prompt and tool list fails on every wording change and gets updated without reading. Assert the parts the test is about: roles, block types, IDs, counts.

## Where the real API still belongs

Some things only the real model can tell you: whether it picks the right tool for a vague question, whether your [tool descriptions](/blog/write-tool-descriptions-claude-uses-well/) are clear enough, whether a new model version still follows your format. Keep those in an eval suite with a small budget, run on changes to prompts, tools or models. One live "smoke test" in CI that makes a single cheap request is also reasonable, to catch an expired API key or a renamed model before your users do.

## Summary

- Split tests by layer: tools (plain unit tests), loop (scripted fake), model behaviour (evals).
- Keep tool logic in normal functions; test the empty case and invalid input, not only the happy path.
- Inject the Anthropic client; a fake that returns scripted messages and records requests is about 25 lines.
- Test parallel calls, thrown errors, unknown tools, turn and spend limits, stop reasons and usage rows.
- Don't make the fake clever and don't snapshot whole requests.
- Use the real API only in evals and one smoke test.

<!-- site-only -->

*Agentwright Starter ships with offline tests for its tool registry, pricing and metering, plus a separate eval runner for real-model checks. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's Messages API and tool use documentation before publishing.*

<!-- /site-only -->
