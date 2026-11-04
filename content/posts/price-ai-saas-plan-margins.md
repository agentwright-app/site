---
title: "How to price an AI SaaS plan so heavy users don't eat your margin"
description: "Worked numbers for a $20/month plan on Claude Sonnet 5.5: cost per request, break-even usage, the request cap that protects a 70% margin, and how model choice and caching move each number. With a free calculator for your own inputs."
date: 2026-11-11
slug: price-ai-saas-plan-margins
tags: [pricing, saas, claude, business]
---

<p class="lede">Classic SaaS has near-zero cost per extra user, so a flat monthly price works. An AI feature has a real cost every time someone uses it, and usage is uneven: most users barely touch it while a few use it all day. Price it like classic SaaS and those few users quietly turn your best plan into a loss. This post works through the numbers for one plan, step by step.</p>

Every number below comes from the [AI SaaS margin calculator](/tools/ai-saas-margin-calculator/) with its default inputs, using Claude API list prices checked on 2026-11-04. Change the inputs there to get the same table for your product.

## The example plan

- Price: **$20 per month**
- Payment fees: 5% + $0.50 per charge (typical for a merchant of record; card processors are lower but you handle tax yourself)
- Other cost per user: $0.50 per month (email, database, hosting share)
- Model: **Claude Sonnet 5.5** ($2 input, $10 output, $0.10 cache read per million tokens)
- A typical request: 4,000 input tokens, 600 output tokens, 60% of the input served from the prompt cache
- A typical user: 300 requests per month

## Step 1: cost per request

```
uncached input  4,000 × 40% × $2.00  / 1e6 = $0.00320
cached input    4,000 × 60% × $0.10  / 1e6 = $0.00024
output            600       × $10.00 / 1e6 = $0.00600
per request                                 = $0.00944
```

Two things stand out. Output tokens are 64% of the cost even though they are 13% of the tokens, because output is priced 5× higher than input. And caching already did a lot of work: with no cache hits the same request costs $0.0140, almost 50% more. If your product sends a long system prompt or a growing conversation, caching is the first lever to pull, before any pricing change. (Cache writes cost slightly more than normal input; this simple model leaves them out, which is close enough when most requests hit a warm cache.)

## Step 2: margin for a typical user

```
revenue                         $20.00
payment fees  $20 × 5% + $0.50   −$1.50
other costs                      −$0.50
API  300 × $0.00944              −$2.83
profit                          $15.17   → 76% margin
```

76% looks healthy, and this is the number most founders stop at. The problem is that "typical" hides the distribution.

## Step 3: the heavy user

AI usage is usually long-tailed. Plenty of users send a handful of requests a month; a few send thousands, often because they built a workflow around your product (which is good) or wired it into a script (which may not be).

The same user at 10× the typical usage:

```
API  3,000 × $0.00944    −$28.32
profit                   −$10.32  → −52% margin
```

And the break-even point, where one user's API cost eats the whole $18 left after fees and other costs:

```
$18.00 / $0.00944 ≈ 1,906 requests per month
```

So on this plan, any user past about 1,900 requests a month costs you money, and you only find out from the invoice. A handful of those users can cancel out the profit from dozens of typical ones.

## Step 4: decide the margin you want, then derive the cap

Work backwards from a target margin instead of hoping the average holds. For a 70% target on $20:

```
allowed total cost   $20 × (1 − 70%)       = $6.00
minus fixed costs    $6.00 − $1.50 − $0.50  = $4.00 for the API
included requests    $4.00 / $0.00944       ≈ 423 per month
```

That gives a clear product decision: **include about 400 requests in the $20 plan.** The typical user at 300 never notices the limit. The heavy user hits it and is offered the next plan or paid extra usage, and every user on the plan earns you at least 70% margin.

What happens at the cap is the second decision:

| Option | Good for | Watch out for |
|---|---|---|
| Hard cap until next month | Free tiers, predictable costs | Frustrates paying users mid-task |
| Upgrade prompt to a bigger plan | Clear upsell path | Needs a plan sized for heavy users |
| Pay-as-you-go overage | Power users, B2B | Bill shock without warnings at 80% and 100% |
| Credits packs | Bursty usage | More billing code |

Show usage in the product either way. Users accept limits they can see coming; they do not accept a surprise error.

## Step 5: price per request, not per token, in your head

Users do not think in tokens, and neither should your plan page. Translate the cap into something they recognise ("about 400 chats a month", "100 documents") and keep the token math internal. But meter in tokens and dollars, because the cost of "one chat" changes when users paste long documents. A cap on dollars of API cost per user per month is the most honest internal limit, because it stays correct when users switch models or request sizes change.

## How the model choice moves everything

Same request shape, same 300 requests, three models:

| Model | Per request | API cost / user | Margin at 300 requests |
|---|---|---|---|
| Claude Haiku 5.5 | $0.00048 | $0.15 | 89% |
| Claude Sonnet 5.5 | $0.00944 | $2.83 | 76% |
| Claude Opus 5.5 | $0.01888 | $5.66 | 62% |

Haiku costs about one twentieth of Sonnet for this request shape. If it handles a feature well enough, the heavy-user problem nearly disappears: even 10× usage costs $1.45. That is why "which model" is a pricing decision as much as a quality one. Run your evals on the cheaper model before you design plan limits around the expensive one; we showed a minimal harness in [Evals for a Claude agent in 140 lines of TypeScript](/blog/evals-for-claude-agents-typescript/).

A common pattern is routing: Haiku for simple, high-volume steps (classification, extraction, short answers) and Sonnet or Opus only for the steps that need it. The blended cost per request then sits between the rows above.

## A short checklist before you publish a price

1. Measure real token counts per request type, not guesses. Log `usage` on every call.
2. Compute cost per request with caching included, per model you use.
3. Pick a target margin and derive the included usage from it.
4. Decide what happens at the cap, and show usage before users hit it.
5. Store the price you used on every usage row, so a future price change does not rewrite your history. We wrote about that in [Model prices change. Snapshot them on every usage row](/blog/snapshot-llm-prices-per-request/).
6. Re-run the numbers when model prices change, and when your heaviest users' behaviour does.

<!-- site-only -->

*Agentwright Starter ships per-plan token caps, per-user cost metering and a usage page, so these limits are configuration rather than a project. It launches in December 2026; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude). The numbers come from our margin calculator and Anthropic's official pricing page, checked before publishing.*

<!-- /site-only -->
