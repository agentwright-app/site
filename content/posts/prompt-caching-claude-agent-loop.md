---
title: "Prompt caching in a Claude agent loop: where the breakpoints go and what silently breaks them"
description: "How Claude prompt caching works as a prefix match, where to put cache_control in a tool-using agent, the cost math with Claude 5.5 prices, the usage fields that prove it works, and the five changes that quietly drop your hit rate to zero."
date: 2026-11-07
slug: prompt-caching-claude-agent-loop
tags: [claude, caching, agents, typescript]
---

<p class="lede">An agent sends the same tool definitions and system prompt on every turn, plus a conversation that only grows. That is the best case for prompt caching, and it is also easy to get silently wrong: nothing errors, the bill is just higher. This post covers where to put the cache markers in an agent loop, what it saves, and how to check that it is working.</p>

Prices and limits below were checked against Anthropic's prompt caching and pricing documentation on 2026-11-04. Code uses `@anthropic-ai/sdk` in TypeScript.

## The mental model: a prefix match

Claude renders a request in a fixed order: **`tools`, then `system`, then `messages`**. When you put `cache_control` on a block, the API caches everything from the start of the request up to and including that block. A later request gets a cache hit only if its rendered prompt is **byte-for-byte identical** up to that point.

That one rule explains everything else:

- Stable content has to come first, volatile content last.
- A change anywhere invalidates the cache for every breakpoint after it. Change a tool description and the system prompt and conversation caches are gone too, because tools render first.
- A breakpoint on the last system block caches tools and system together.

## Where the markers go in an agent loop

An agent request has three layers that change at different speeds:

| Layer | Changes | Cache strategy |
|---|---|---|
| Tool definitions | When you deploy | Inside the first cached prefix |
| System prompt | When you deploy | Breakpoint on its last block |
| Conversation | Every turn | Breakpoint that moves forward with the conversation |

A setup that covers both:

```ts
const stream = client.messages.stream({
  model: "claude-sonnet-5-5",
  max_tokens: 8192,
  // 1. Automatic caching: the API puts a breakpoint on the last cacheable block
  //    and moves it forward as the conversation grows.
  cache_control: { type: "ephemeral" },
  // 2. An explicit breakpoint on the static prefix (tools + system), so that part
  //    has a guaranteed read point whatever happens later in `messages`.
  system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
  tools,
  messages,
});
```

The explicit marker on the system prompt protects the expensive shared part: every user and every conversation reads the same tools-plus-system entry. The top-level `cache_control` handles the growing tail, so turn 5 of a conversation reads turns 1 to 4 from cache and only pays full price for what turn 4 added.

You can have at most **4** breakpoints per request, and the automatic one uses a slot. Two is enough for most agents.

## What it saves, with real numbers

Caching changes the price of input tokens, not output tokens. For Claude Sonnet 5.5, per million tokens:

| | Price | vs. normal input |
|---|---|---|
| Normal input | $2.00 | 1× |
| Cache write, 5-minute TTL | $2.50 | 1.25× |
| Cache write, 1-hour TTL | $4.00 | 2× |
| Cache read | $0.10 | 0.05× |

Take a support agent with 6,000 tokens of tools and system prompt and about 1,000 new tokens per request, ten requests inside five minutes:

```
Without caching:  10 × 7,000 × $2.00 / 1e6                       = $0.140
With caching:     first request  6,000 × $2.50 + 1,000 × $2.00   = $0.017
                  next nine      9 × (6,000 × $0.10 + 1,000 × $2.00) = $0.0234
                  total                                            = $0.040
```

About 70% less on input, from two lines of code. The write premium pays for itself on the second request with a 5-minute TTL. With the 1-hour TTL the write costs 2×, so you need a few more reads before it is cheaper; use it when traffic has gaps longer than five minutes but shorter than an hour. Each cache read also refreshes the entry, so steady traffic keeps a 5-minute entry alive indefinitely.

<!-- site-only -->

If you want to try your own token counts and hit rates, the [Claude API cost calculator](/tools/claude-api-cost-calculator/) has a cache hit rate slider.

<!-- /site-only -->

## Prove it with the usage fields

Every response tells you what happened:

```ts
const final = await stream.finalMessage();
const u = final.usage;
console.log({
  uncached: u.input_tokens,                     // full price
  written: u.cache_creation_input_tokens ?? 0,  // write premium
  read: u.cache_read_input_tokens ?? 0,         // discounted
});
```

`input_tokens` is only the uncached remainder. The full prompt size is the sum of all three. A healthy multi-turn agent looks like this from turn to turn:

- `cache_read_input_tokens` grows: it is the whole previous conversation.
- `cache_creation_input_tokens` stays small: roughly the last assistant turn plus the new input.
- `input_tokens` is tiny.

If `cache_read_input_tokens` is 0 on the second identical request, something is breaking the prefix. Turn that into a test so it cannot regress unnoticed:

```ts
test("system prompt + tools are cached", async () => {
  const req = { model: "claude-haiku-5-5", max_tokens: 16, system, tools, messages: [{ role: "user", content: "hi" }] } as const;
  await client.messages.create(req);
  const second = await client.messages.create(req);
  expect(second.usage.cache_read_input_tokens).toBeGreaterThan(0);
});
```

Store the three numbers per request too. If you meter usage per user, you already have a row per call; add the cache columns and price them separately. Our post on [metering Claude API costs per user](/blog/meter-claude-api-costs-per-user-nextjs/) shows the table.

## Five things that silently break the cache

**1. A timestamp or request id in the system prompt.** `Today is ${new Date().toISOString()}` changes every request, so the cache never hits. If the model needs the date, put it in the user message, after the cached prefix, and use the day rather than the second.

**2. Tool definitions in a non-deterministic order.** If your tool list is built from an object, a set or an async discovery step (MCP servers connecting in a different order), the rendered bytes change between requests. Sort tools by name before sending them.

**3. A tool list that varies per request.** Showing different tools to different plans is reasonable, but each distinct list is its own cache entry, and adding a tool mid-conversation invalidates everything after the tools. Prefer a fixed list per plan, or keep the tool available and refuse inside it.

**4. Changing thinking or effort settings per request.** These are part of the cache key for the messages layer. Pick them per route (chat, background job) rather than per message.

**5. Rewriting history.** Trimming old messages, editing an earlier turn or re-summarising the conversation in place changes the prefix. Compaction is sometimes worth it; just know each rewrite costs a fresh write. Append-only histories cache best.

Two more facts that explain a low hit rate when the code looks right:

- **Below the minimum length nothing is cached**, with no error, just `cache_creation_input_tokens: 0`. The minimum depends on the model (512 tokens on the current 5.5 models at the time of writing, and 1,024 to 4,096 on several older ones), so check the table in the docs for the model you use.
- **Caches are scoped.** They are separate per model and per workspace. Splitting the same traffic across two API workspaces, or routing it across two models, means two caches that each warm up separately.

## Long agent turns

Each breakpoint looks back a limited number of content blocks (20) for an earlier cache entry. A turn with many sequential tool calls and results can push the previous entry out of that window, and the next request misses even though nothing changed. If your agents run long tool chains in a single turn, add an explicit breakpoint on a tool result every 15 or so blocks.

## Summary

- Order: tools, system, messages. Stable first.
- One explicit breakpoint on the system prompt, plus top-level automatic caching for the conversation.
- Check `cache_read_input_tokens` on the second request, and keep that check as a test.
- Keep timestamps, ids and per-request variation after the last breakpoint.
- Sort tools; keep thinking and effort fixed per route; append to history instead of editing it.

<!-- site-only -->

*Agentwright Starter's agent loop caches the system prompt and keeps MCP tool names sorted for exactly these reasons, and its usage table records cache reads and writes per call. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's prompt caching and pricing documentation before publishing.*

<!-- /site-only -->
