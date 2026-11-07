---
title: "Give your Claude agent web search: the server tool, what it costs per user, and the limits to set"
description: "How to add Anthropic's web search server tool to an AI agent SaaS: the tool definition, max_uses and domain filters, reading server_tool_use and citations from the response, pause_turn, why encrypted results must be sent back unchanged, and metering the $10 per 1,000 searches per user."
date: 2026-12-11
slug: claude-web-search-tool-agent-saas
tags: [claude, typescript, cost, tools]
---

<p class="lede">Users ask agents about things that happened after the model's training data ends: today's prices, a library's newest release, a company's latest announcement. Anthropic's web search tool lets Claude search and cite sources without you running a search API or a scraper. It is a server tool, so it behaves differently from your own tools in the loop, and it adds a second price on top of tokens. This post covers both.</p>

The API details below follow Anthropic's web search tool documentation, checked on 2026-11-07.

## A server tool, not one of yours

Your own tools return `tool_use` blocks that your code executes. Web search runs on Anthropic's side, inside the same API call: Claude decides to search, the API runs the search, feeds the results back to Claude, and the response you receive already contains the search, the results and the answer. Your agent loop does not execute anything for it.

```ts
const response = await client.messages.create({
  model: "claude-sonnet-5-5",
  max_tokens: 16000,
  tools: [
    { type: "web_search_20260209", name: "web_search", max_uses: 3 },
    ...yourTools,
  ],
  messages,
});
```

There are three versions of the tool. `web_search_20250305` is basic search. `web_search_20260209` and later add **dynamic filtering**: on recent models, Claude runs code that filters search results before they enter the context window, which cuts token use on search-heavy requests, at no extra charge beyond tokens. Use the newest version your model and platform support; some cloud platforms only offer the basic one.

Web search is on for an organization unless an admin turned it off in the Claude Console. If it is off, a request with the tool fails with a 400, which you will see in your first test, not in production.

## The settings worth using

- **`max_uses`** caps searches per turn. A simple factual question takes 1 to 3; research questions can take 10 or more. This is your main cost control. Searches beyond the cap come back as a `max_uses_exceeded` error result, and Claude answers with what it has.
- **`allowed_domains` or `blocked_domains`** (one or the other, not both). For a product that answers about one ecosystem, an allow list ("nextjs.org", "vercel.com", "github.com") gives more relevant answers and fewer junk sources.
- **`user_location`** (approximate city, region, country, time zone) for questions where location matters, such as local businesses or regional prices. Pass what you know about the user's country, not their exact address.

Set these per route. A research assistant route might allow 8 searches; a support chat that should mostly answer from your docs might allow 1, or not have the tool at all.

## Reading the response

The response content now includes three new block types:

- `server_tool_use` with `name: "web_search"` and the `query` Claude used.
- `web_search_tool_result` with the results (`url`, `title`, `page_age` and `encrypted_content`).
- `text` blocks with a `citations` array of `web_search_result_location` entries (`url`, `title`, `cited_text` up to 150 characters).

For your UI: show the query as a status line ("Searching: nextjs 16 release notes"), and render citations as links next to the sentences they support. Anthropic's documentation asks that answers shown directly to end users include the citations to the original sources, so this is required, not just nice.

When [streaming](/blog/stream-claude-agent-sse-nextjs/), the `server_tool_use` block arrives first, then a pause while the search runs, then the results block. Show something during the pause; a frozen stream looks like a crash.

## Three loop details that bite

**Send the blocks back unchanged.** In the next request of the conversation, the assistant's content must go back exactly as you received it, including each result's `encrypted_content`. If you strip, edit or re-serialize them lossily, the request fails with a 400. This is one more reason to [store every block, append only](/blog/store-agent-conversations-append-only/), instead of saving only the text.

**Handle `pause_turn`.** A long search turn can stop with `stop_reason: "pause_turn"`. Send the paused assistant message back as-is in a new request, and the API continues. If Claude calls web search and one of your client tools in the same group of parallel calls, you get `tool_use` instead; return your tool results and the search runs in the next request. The [stop reasons post](/blog/handle-claude-stop-reasons-agent/) covers the full loop.

**Errors come back as a success.** A failed search (rate limit, query too long, unavailable) is a 200 response whose `web_search_tool_result` contains an error object with an `error_code` instead of a list of results. Do not index into the content without checking which it is.

## What it costs

Two parts:

1. **$10 per 1,000 searches** ($0.01 each) on the Claude API. Each search counts once, however many results it returns. Failed searches are not billed.
2. **Tokens.** Search results are counted as input tokens, in the turn where the search happened and again on every later turn of the conversation, because they stay in the history.

The second part is often bigger. A search turn can add several thousand tokens of results; ten more turns of conversation read them ten more times. [Prompt caching](/blog/prompt-caching-claude-agent-loop/) cuts the repeat cost, and dynamic filtering keeps less of the raw result text.

## Metering it per user

The response's `usage` tells you how many searches ran:

```ts
const searches = response.usage.server_tool_use?.web_search_requests ?? 0;
await recordUsage({
  userId,
  inputTokens: response.usage.input_tokens,
  outputTokens: response.usage.output_tokens,
  webSearches: searches,
  webSearchCostMicroUsd: searches * 10_000, // $0.01 per search
});
```

Add a `web_searches` column to your [usage table](/blog/meter-claude-api-costs-per-user-nextjs/) and include it in cost reports and [spend limits](/blog/per-user-spend-limits-in-dollars/). A user who triggers 300 searches a day costs $3 a day in searches alone, before tokens; that will show up in your [most expensive users](/blog/find-most-expensive-users-sql/) query only if you record it. If your plans are priced tight, give web search its own monthly allowance per plan, as the [pricing post](/blog/price-ai-saas-plan-margins/) suggests for any expensive feature.

## Web search and prompt injection

Search results are text from pages you do not control, now inside your agent's context. Treat them like any other untrusted tool output: a page can contain instructions. Keep tools with side effects behind your own checks and, for risky actions, [human approval](/blog/approval-gates-for-agent-tool-calls/). An `allowed_domains` list reduces the risk; it does not remove it.

## Summary

- Web search is a server tool: Anthropic runs it inside the API call; your loop executes nothing.
- Set `max_uses` and a domain filter per route; use the newest tool version your platform supports.
- Show queries and citations in the UI; citations are required when showing answers to end users.
- Send result blocks back unchanged, handle `pause_turn`, and check for error results.
- Meter `web_search_requests` per user at $0.01 each, and remember results are re-read as input tokens on later turns.

<!-- site-only -->

*Agentwright Starter meters usage per model call with a price snapshot, where a web search count fits as one more column. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's API documentation before publishing.*

<!-- /site-only -->
