---
title: "Claude API pricing calculator: monthly, per-request and per-user cost in 30 seconds"
description: "A free calculator for Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5 costs. Enter requests, tokens and cache hit rate, get monthly and per-user cost, share the result by link."
date: 2026-11-01
slug: claude-api-pricing-calculator
tags: [claude, pricing, tools]
---

Before you price an AI feature you need one number: what a typical user costs you per month. Multiplying token counts by per-million prices is simple, but between three models, cache reads, the Haiku long-prompt tier and the Batch discount it is easy to get wrong, and tedious to redo every time someone asks "what if we use Sonnet?".

So we built a small free tool: **[Claude API Cost Calculator](/tools/claude-api-cost-calculator/)**.

## What it does

- Pick a model (Claude Opus 5.5, Sonnet 5.5 or Haiku 5.5), enter requests per month, input and output tokens per request, your prompt-cache hit rate and monthly active users.
- Get monthly cost, cost per request and cost per active user, with input and output broken out.
- See the same workload priced on all three models side by side, so routing decisions take seconds.
- Toggle the Batch API to apply the 50% discount.
- Every change is written to the URL. Copy the link and paste it into a pull request, a pricing doc or a Slack thread; whoever opens it sees the same inputs.

## Where the prices come from

The table is a single [pricing.json](/tools/claude-api-cost-calculator/pricing.json) checked against the [official pricing page](https://platform.claude.com/docs/en/about-claude/pricing). The page shows the date it was last verified. As of 2026-11-01, per million tokens:

| Model | Input | Output | Cache read |
|---|---|---|---|
| Claude Opus 5.5 | $4 | $20 | $0.20 |
| Claude Sonnet 5.5 | $2 | $10 | $0.10 |
| Claude Haiku 5.5 (prompt ≤ 100K) | $0.10 | $0.50 | $0.01 |
| Claude Haiku 5.5 (prompt > 100K) | $0.50 | $2.50 | $0.05 |

Two details the calculator handles for you: cache reads are 5% of the input price on Opus and Sonnet 5.5 but 10% on Haiku 5.5, and Haiku requests whose prompt exceeds 100,000 tokens switch to the higher tier for the whole request.

## What it leaves out

It does not add the one-time cache-write surcharge (1.25× input for a 5-minute cache, 2× for 1 hour), because that is paid once per cache window rather than once per request and usually amounts to a few percent. Extended thinking tokens are billed as output, so add them to the output figure if you use it. It is an estimate; for actual numbers you need to meter real usage.

## From estimate to actual

Once the feature ships, the estimate should be replaced with measured per-user cost. [How to meter Claude API costs per user in a Next.js SaaS](/blog/meter-claude-api-costs-per-user-nextjs/) shows the whole layer: one usage table, one pricing module with the same numbers as the calculator, and a usage page. Agentwright Starter ships that layer ready to use.

Try the [calculator](/tools/claude-api-cost-calculator/) and, if a price changes or you find a case it gets wrong, email hello@agentwright.app.
