---
title: "Parallel tool calls with Claude: run them concurrently and return every result in one message"
description: "How parallel tool use works in the Claude API, why all tool_result blocks must go back in a single user message, how to run the calls concurrently with Promise.all, limit concurrency, handle one failing call with is_error, and when to turn parallel calls off."
date: 2026-12-15
slug: parallel-tool-calls-claude-agent-loop
tags: [ai, typescript, llm, performance]
---

<p class="lede">Ask an agent "compare the weather in Lisbon, Seoul and Austin" and Claude will usually answer with three <code>tool_use</code> blocks in one response. What your loop does next decides whether the user waits one second or three, and whether Claude keeps making parallel calls on later turns at all. This post covers the rules, the code, and the two mistakes that quietly turn parallel calls off.</p>

## What Claude sends

Parallel tool use is on by default. When the model decides it needs several independent pieces of information, one assistant message contains several `tool_use` blocks, each with its own `id`:

```json
{
  "role": "assistant",
  "stop_reason": "tool_use",
  "content": [
    { "type": "text", "text": "I'll check all three cities." },
    { "type": "tool_use", "id": "toolu_01A", "name": "get_weather", "input": { "city": "Lisbon" } },
    { "type": "tool_use", "id": "toolu_01B", "name": "get_weather", "input": { "city": "Seoul" } },
    { "type": "tool_use", "id": "toolu_01C", "name": "get_weather", "input": { "city": "Austin" } }
  ]
}
```

Your loop owes Claude one `tool_result` for every `tool_use` id, and the next request must include them.

## Rule 1: all results go back in one user message

The correct reply is a single user message that holds every result:

```json
{
  "role": "user",
  "content": [
    { "type": "tool_result", "tool_use_id": "toolu_01A", "content": "{\"temp_c\":17}" },
    { "type": "tool_result", "tool_use_id": "toolu_01B", "content": "{\"temp_c\":4}" },
    { "type": "tool_result", "tool_use_id": "toolu_01C", "content": "{\"temp_c\":12}" }
  ]
}
```

The tempting alternative, one user message per result, is accepted by the API (consecutive messages of the same role are merged), but sending results as separate turns teaches the model from its own history that tool calls happen one at a time. Over a conversation it makes fewer parallel calls, and your agent gets slower without any error to tell you why. Put the `tool_result` blocks first in the content array; if you add text for the model, put it after them.

## Rule 2: run the calls concurrently

The point of parallel calls is latency. If three tools each take 800 ms, running them in sequence costs 2.4 seconds; running them together costs about 0.8. In TypeScript, `Promise.all` over the `tool_use` blocks does it, and each call catches its own error so one failure does not reject the batch:

```ts
import Anthropic from "@anthropic-ai/sdk";

async function runToolCalls(content: Anthropic.ContentBlock[]): Promise<Anthropic.ToolResultBlockParam[]> {
  const calls = content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  return Promise.all(
    calls.map(async (call): Promise<Anthropic.ToolResultBlockParam> => {
      try {
        const result = await runTool(call.name, call.input);
        return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) };
      } catch (e) {
        return {
          type: "tool_result",
          tool_use_id: call.id,
          content: `Tool error: ${(e as Error).message}`,
          is_error: true,
        };
      }
    }),
  );
}

// in the loop
messages.push({ role: "assistant", content: final.content });
if (final.stop_reason === "tool_use") {
  messages.push({ role: "user", content: await runToolCalls(final.content) });
}
```

`Promise.all` keeps the order of the input array, so results line up with the calls. Order does not matter to the API (it matches by `tool_use_id`), but it makes traces easier to read.

## A failed call is a result, not an exception

If one of three calls fails, return the two good results and one result with `is_error: true` and a message the model can act on ("City not found: Austinn. Check the spelling."). Do not drop the failed call: a `tool_use` without a matching `tool_result` makes the next request fail with a 400. Do not throw out of the loop either, since the model can often recover by retrying with corrected input or by answering with what it has. The [errors and retries post](/blog/claude-api-errors-retries-agent-loop/) separates these tool errors from API errors that deserve a retry.

## Limit concurrency for tools that share a resource

Unbounded concurrency is fine for a handful of read-only calls. It is not fine when the model asks for 15 database queries at once against a small connection pool, or 10 calls to a third-party API with a rate limit. A small limiter keeps the parallelism without the stampede:

```ts
function limit(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => queue.push(r));
    active++;
    try { return await fn(); } finally { active--; queue.shift()?.(); }
  };
}

const dbSlot = limit(4);
// inside the map: await dbSlot(() => runTool(call.name, call.input))
```

Give each shared resource its own limiter rather than one global limit, so a slow external API does not hold up fast local lookups.

## When to turn parallel calls off

Some tools must not run together: two calls that write the same record, a `charge_card` next to a `refund`, or steps where the second depends on the first's result. You have three options, from narrowest to broadest:

1. **Serialize in your code.** Run side-effect tools one at a time even when they arrive together, and keep read-only tools concurrent. This keeps the model's behaviour unchanged.
2. **Say so in the tool description.** "Call this tool at most once per turn" works for most cases; see [how to write tool descriptions](/blog/write-tool-descriptions-claude-uses-well/).
3. **Set `disable_parallel_tool_use: true` on `tool_choice` with type `auto`.** Claude then makes at most one tool call per response. It slows every multi-lookup task, so use it per route, not globally.

Tools that need a human's approval should also run one at a time behind the gate; the [approval gates post](/blog/approval-gates-for-agent-tool-calls/) shows that flow.

## What it does to cost

Parallel calls usually save money as well as time. Three sequential calls mean three model turns, and every turn re-reads the whole conversation as input. Three parallel calls mean one turn with three results. With Claude Sonnet 5.5 ($2 per million input tokens, $0.10 for cache reads) and a 20,000-token conversation that is mostly cached, each extra turn costs roughly $0.002 to $0.004 in input plus the output it writes. That is small per request, and it adds up across users; your [per-user metering](/blog/meter-claude-api-costs-per-user-nextjs/) will show it as fewer usage rows per answer.

## Summary

- One assistant message can hold several `tool_use` blocks; answer every id.
- Return all `tool_result` blocks in a single user message, results first.
- Run the calls with `Promise.all`, each with its own try/catch, and return failures with `is_error: true`.
- Limit concurrency per shared resource, and serialize side-effect tools in code.
- Use `disable_parallel_tool_use` only on routes that need strict one-at-a-time behaviour.

<!-- site-only -->

*Agentwright Starter's agent loop runs every tool call of a turn with `Promise.all`, returns failures as `is_error` results, and sends all results back in one user message. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
