---
title: "Long Claude agent conversations: when to clear tool results, when to compact, and what each costs"
description: "A practical guide to keeping long-running Claude agent conversations small: context editing to clear old tool results, server-side compaction at a token threshold or on demand, how each interacts with prompt caching and billing, and the one mistake that silently disables compaction."
date: 2026-11-25
slug: long-agent-conversations-compaction-context-editing
tags: [claude, agents, typescript, llm]
---

<p class="lede">A one-million-token context window makes it easy to ignore conversation length. Then the bills come in. An agent that reads files or web pages resends every old tool result on every turn, so the fiftieth turn of a session pays for the first forty-nine again (at the cache-read rate, if your caching works). And quality drops as context grows, long before the window is full. Claude's API has two server-side tools for this: context editing, which clears old tool results, and compaction, which replaces old turns with a summary. They solve different problems.</p>

Parameter names, defaults and model support below were checked against Anthropic's context editing and compaction documentation on 2026-11-05. Both features are in beta, so check the docs before you depend on a detail.

## First, measure

Before adding either feature, look at what your long conversations are made of. From your [usage records](/blog/meter-claude-api-costs-per-user-nextjs/), find sessions with more than, say, 100,000 input tokens per turn, and check the share that is tool results. In a typical tool-heavy agent (file reads, search results, database rows), tool results are most of the context, and most of them stopped mattering a few turns after they were read. In a chat-heavy product, the bulk is the conversation itself. The first case calls for context editing, the second for compaction.

## Context editing: clear old tool results

Context editing runs on the server before the request reaches the model. Once the prompt passes a threshold, it replaces the oldest tool results with a short placeholder saying the result was removed, and keeps the most recent ones. Your stored history is not changed; you keep sending the full conversation.

```ts
const final = await client.beta.messages.stream({
  model: "claude-sonnet-5-5",
  max_tokens: 16000,
  betas: ["context-management-2025-06-27"],
  context_management: {
    edits: [{
      type: "clear_tool_uses_20250919",
      trigger: { type: "input_tokens", value: 60_000 },   // default: 100,000
      keep: { type: "tool_uses", value: 4 },               // default: 3
      clear_at_least: { type: "input_tokens", value: 20_000 },
      exclude_tools: ["get_user_profile"],
    }],
  },
  system, tools, messages,
}).finalMessage();
```

What each setting does:

- **`trigger`**: clearing starts once the prompt exceeds this many input tokens (or a number of tool uses).
- **`keep`**: the most recent tool use/result pairs that are never cleared.
- **`clear_at_least`**: the minimum to clear each time; if the API cannot clear that much, it clears nothing. This matters for caching (below).
- **`exclude_tools`**: tools whose results must stay, such as a small profile lookup the model refers back to.
- **`clear_tool_inputs`**: also clear the tool call's input, not only the result. Off by default; turn it on if your tools take large inputs, such as file contents to write.

The response reports what happened in `context_management.applied_edits` (how many tool uses and input tokens were cleared). Log it next to your usage row so you can see the effect.

**The cost of clearing is a cache miss.** Clearing changes the prompt prefix, so the next request writes a new cache entry instead of reading the old one. If the API cleared 3,000 tokens every turn, you would pay a cache write every turn and save almost nothing. That is what `clear_at_least` prevents: set it high enough that each clear removes a large block, so the occasional cache write is outweighed by many cheaper turns afterwards.

**Make cleared results recoverable.** The model may later want something it read twenty turns ago. If your tools are cheap to re-run (read the file again, run the query again), clearing is harmless; the model calls the tool again. If a result is expensive or cannot be reproduced, write the important part into the conversation (or a notes tool) before it can be cleared, or exclude that tool.

## Compaction: replace old turns with a summary

Compaction is for conversations whose content itself matters: a long planning session, a support chat that has gone on for an hour, a coding agent with a long history of decisions. Claude writes a summary of the older part on the server, and later requests start from the summary instead of the full history.

There are two ways to run it.

### At a token threshold (the API decides when)

Add one edit to your normal requests. When the input reaches the trigger, the API summarizes first, then answers:

```ts
const response = await client.beta.messages.create({
  model: "claude-sonnet-5-5",
  max_tokens: 16000,
  betas: ["compact-2026-01-12"],
  context_management: {
    edits: [{ type: "compact_20260112", trigger: { type: "input_tokens", value: 150_000 } }],
  },
  system, tools, messages,
});

// Append the whole content array, not just the text.
messages.push({ role: "assistant", content: response.content });
```

The default trigger is 150,000 tokens and the minimum is 50,000. When compaction runs, the response starts with a `compaction` block that holds the summary. On the next request the API ignores everything before that block.

**The silent mistake:** many loops store only the text of each reply (`messages.push({ role: "assistant", content: text })`). That drops the `compaction` block, so the next request sends the full history again, and compaction appears to do nothing. Append `response.content` as it came back. If you persist conversations in your database, store the content blocks, not a flattened string. An [append-only message log](/blog/store-agent-conversations-append-only/) that stores raw blocks handles this naturally.

Two more options: `instructions` replaces the default summarization prompt completely (it does not add to it), so if you use it, say everything the summary must keep, such as file paths, decisions and open questions. And `pause_after_compaction: true` makes the API stop after writing the summary, with `stop_reason: "compaction"`, so you can re-add the last few turns word for word before continuing.

### On demand (you decide when)

A newer beta (`compact-2026-09-04`) lets you request a summary explicitly: send the conversation with a top-level `compaction: { type: "summarize" }` parameter, get back a single compaction block, and put it first in `messages` in place of the turns it summarizes. Anthropic recommends this form where it is available, because you control the timing. For example, you can compact between a user's sessions, when no one is waiting for an answer, instead of in the middle of a reply. It also supports keeping recent turns verbatim and compacting in the background. It cannot be combined with `context_management` on the same request, so pick one approach per conversation.

## Compaction costs a request

Writing the summary is an extra sampling step, billed like any other. With threshold compaction, the top-level `input_tokens` and `output_tokens` of the response **exclude** the compaction step; the full picture is in `usage.iterations`, one entry per step, with the compaction entry marked `"type": "compaction"`. If your metering reads only the top-level fields, you will under-count every compacting turn:

```ts
const iterations = (response.usage as any).iterations as Array<{ type: string; input_tokens: number; output_tokens: number }> | undefined;
const billed = iterations?.length
  ? iterations.reduce((s, i) => ({ input: s.input + i.input_tokens, output: s.output + i.output_tokens }), { input: 0, output: 0 })
  : { input: response.usage.input_tokens, output: response.usage.output_tokens };
```

Compaction also resets the cache: the summary is new content, so the turn after compaction writes a new cache entry. Both costs are one-off per compaction and are repaid by many cheaper turns afterwards, as long as the trigger is high enough that compaction is rare.

## Which one, when

| Situation | Use |
|---|---|
| Agent re-reads files, pages or query results it can fetch again | Context editing (`clear_tool_uses_20250919`) |
| Long human conversation where earlier decisions matter | Compaction |
| Tool-heavy agent that also runs for hours | Both: clear tool results early, compact much later |
| Conversations rarely exceed 50,000 tokens | Neither. Prompt caching alone is enough |
| State must survive across sessions | Neither; store it yourself (a memory tool or your own tables) |

## Summary

- Measure first: tool results versus conversation text decides the tool.
- Context editing clears old tool results server-side; set `clear_at_least` so the cache misses it causes are rare, and keep tools re-runnable.
- Compaction summarizes old turns; append `response.content`, not the text, or it silently does nothing.
- Threshold compaction is one edit on normal requests; on-demand compaction gives you control over timing.
- Meter compaction from `usage.iterations`; the top-level usage fields leave it out.

<!-- site-only -->

*Agentwright Starter's agent loop keeps each assistant turn as the API's full content blocks (not flattened text) and records usage per response with price snapshots, so either feature can be switched on without changing how conversations are stored. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's context editing and compaction documentation before publishing.*

<!-- /site-only -->
