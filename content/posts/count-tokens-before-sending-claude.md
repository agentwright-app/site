---
title: "Count tokens before you call Claude: price checks, upload limits and model routing with count_tokens"
description: "Claude's token counting endpoint is free and accepts the same input as a real request. When it is worth an extra round trip (uploads, budgets, routing, context limits), when the previous response's usage is the better estimate, what it cannot count, and why other tokenizers give the wrong answer."
date: 2026-11-24
slug: count-tokens-before-sending-claude
tags: [claude, ai, typescript, saas]
---

<p class="lede">Most cost controls in an AI app look backwards: the response arrives, you read <code>usage</code>, you record what it cost. That is the right place to bill. But a few decisions have to be made before the request: will this 300-page PDF fit, can this user afford this request, should it go to the small model or the big one? For those, Claude has a token counting endpoint. It is free, and it is often skipped because people assume a local tokenizer is good enough. It is not.</p>

Endpoint behaviour, limits and prices below were checked against Anthropic's token counting and pricing documentation on 2026-11-05.

## What the endpoint does

`POST /v1/messages/count_tokens` takes the same body as a Messages request (`model`, `system`, `messages`, `tools`, `thinking`) and returns one number:

```ts
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();

const { input_tokens } = await client.messages.countTokens({
  model: "claude-sonnet-5-5",
  system,
  tools,
  messages,
});
```

Things worth knowing before you build on it:

- **It is free**, with its own requests-per-minute limit (5,000 RPM on the lowest usage tier), separate from your Messages rate limit.
- **It is an estimate.** The real request can differ by a small amount, and the count may include tokens Anthropic adds for its own purposes, which you are not billed for. Treat it as accurate to within a few percent, not to the token.
- **It is per model.** Claude Opus 4.7 and later models use a newer tokenizer that produces roughly 30% more tokens for the same text than earlier models. Count with the model you will actually call.
- **It ignores caching.** The count is the full input; it does not tell you how much would be a cache read.
- **Some inputs are rejected:** server tools such as web search and code execution, the MCP connector, and image or document blocks that use a `url` or `file` source. Send images and PDFs as base64 to count them.

## Why not a local tokenizer

Libraries like `tiktoken` implement OpenAI's tokenizers. Claude's tokenizer is different, and the gap is not constant: it varies with language and with how much code is in the text, and the newer Claude tokenizer moved it again. A "count, then add 20%" rule will be wrong for some of your users in either direction. The endpoint answers for the exact model, tools and attachments you are about to send, so use it whenever a decision depends on the number.

## Use 1: reject an upload before it costs anything

A user uploads a PDF and asks a question about it. If the document plus the conversation exceeds what you allow, you want to say so immediately, not after a failed or expensive call.

```ts
const LIMIT = 150_000; // your product's per-request cap, below the model's context window

const { input_tokens } = await client.messages.countTokens({
  model,
  system,
  messages: [{ role: "user", content: [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
    { type: "text", text: question },
  ] }],
});

if (input_tokens > LIMIT) {
  return { error: `This document is about ${Math.round(input_tokens / 1000)}k tokens; the limit is ${LIMIT / 1000}k. Try a shorter section.` };
}
```

Saying "about 210k tokens, the limit is 150k" is far more useful to the user than a generic error. Count once when the file is uploaded and store the number with the file; you do not need to count it again on every question.

## Use 2: check the price before a large request

The [per-user spend limits](/blog/per-user-spend-limits-in-dollars/) post checks the worst case before each call. The worst case is `input tokens × input price + max_tokens × output price`, and for large inputs, guessing the first half is where the check goes wrong. With a count:

```ts
const PRICE = { input: 2.0, output: 10.0 }; // Claude Sonnet 5.5, $ per million tokens (2026-11-05)

const worstCaseUsd =
  (input_tokens * PRICE.input + maxTokens * PRICE.output) / 1_000_000;

if (spentThisMonthUsd + worstCaseUsd > budgetUsd) {
  return { error: "This request would exceed your monthly AI budget." };
}
```

For a 120,000-token document on Claude Sonnet 5.5 with `max_tokens` of 8,000, that is $0.24 + $0.08 = $0.32 at most. Cache reads would make the real cost lower, which is fine: a budget check should err on the side of the worst case.

## Use 3: route by size

Some products send short requests to a fast, cheap model and long ones to a stronger model, or the reverse: long, simple extraction jobs to the cheapest model that handles them well. Counting makes the rule explicit:

```ts
const model = input_tokens > 50_000 ? "claude-haiku-5-5" : "claude-sonnet-5-5";
```

Count with one model and route to another only if the two share a tokenizer; otherwise count again for the model you chose. Also check the pricing tiers: Claude Haiku 5.5 costs $0.10 / $0.50 per million tokens up to 100,000 input tokens and $0.50 / $2.50 above that, so a routing rule based on size should also consider which side of that line a request lands on. (The [model choice post](/blog/choose-claude-model-per-route/) covers routing in more detail.)

## When not to call it: the agent loop

In a multi-turn agent loop, a count before every turn adds a round trip of latency for a number you almost have already. The previous response's `usage` tells you how big the conversation was:

```ts
function contextSize(u: Anthropic.Usage) {
  return u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + u.output_tokens;
}
```

With prompt caching, `input_tokens` counts only the tokens after the last cache breakpoint, so add the cache read and cache creation counts, plus the output that becomes part of the next request. Add the size of the tool results you are about to append and you have a good estimate for the next turn, with no extra call. Use the endpoint only when something new and large enters the conversation, such as an upload or a big tool result.

## Do not show the count as a price

It is tempting to show users "this will cost 1,234 tokens". Do not. Users do not know what a token is, and the number they see will not match their bill, because output and cache reads change the real cost. If you show anything, show dollars or a share of their monthly allowance, from your own [usage records](/blog/meter-claude-api-costs-per-user-nextjs/), after the request.

## Summary

- `count_tokens` is free, rate-limited separately, and takes the same body as a real request.
- Count with the exact model you will call; Claude's newer tokenizer gives about 30% more tokens than older ones, and non-Claude tokenizers are wrong by an unpredictable amount.
- Good uses: rejecting oversized uploads with a clear message, worst-case budget checks before large requests, size-based routing.
- In an agent loop, estimate from the last response's `usage` (including cache fields) instead of counting every turn.
- Server tools, the MCP connector and `url`/`file` sources cannot be counted.

<!-- site-only -->

*Agentwright Starter checks each user's rate limit before every agent request and records exact usage with price snapshots after it. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's token counting documentation before publishing.*

<!-- /site-only -->
