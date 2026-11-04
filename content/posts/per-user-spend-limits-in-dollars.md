---
title: "Per-user spend limits for an AI SaaS: cap dollars, not tokens, and close the race"
description: "Why a monthly token cap does not protect your margin, how to cap each user's Claude API spend in dollars with a pre-request worst-case check, how two parallel requests slip past a naive check, and the last line of defence most apps forget."
date: 2026-11-15
slug: per-user-spend-limits-in-dollars
tags: [claude, saas, postgres, billing]
---

<p class="lede">Every AI SaaS eventually meets the user who leaves a script running overnight. A rate limit slows them down; a monthly cap is what stops them. Most first versions of that cap count tokens. This post explains why a token cap leaks money, how to cap spend in dollars instead, and the concurrency bug that lets a determined user go over any limit that is checked with a simple SELECT.</p>

The code is TypeScript with Postgres. Prices are Anthropic's list prices, checked on 2026-11-04.

## Why tokens are the wrong unit

A token cap treats every token the same. Your bill does not:

| Claude Sonnet 5.5, per million tokens | Price |
|---|---|
| Cache read | $0.10 |
| Input | $2.00 |
| Output (including thinking) | $10.00 |

That is a 100× spread inside one model, before you count the 40× spread between Claude Haiku 5.5 and Claude Opus 5.5. A user with a 2M-token monthly cap could cost you $0.20 (all cache reads on Sonnet) or $40 (all output on Opus). You set the cap for an average mix; the expensive user is, by definition, not average.

If you already store a cost per usage row, and you should (see [metering Claude API costs per user](/blog/meter-claude-api-costs-per-user-nextjs/)), the fix is to cap the sum of that column instead.

## The budget lives on the plan

```sql
ALTER TABLE plans ADD COLUMN monthly_budget_micro_usd bigint NOT NULL DEFAULT 0;

-- Example: $3 of API cost on free, $12 on a $29 plan, $60 on a $99 plan.
UPDATE plans SET monthly_budget_micro_usd = 3000000  WHERE id = 'free';
UPDATE plans SET monthly_budget_micro_usd = 12000000 WHERE id = 'pro';
UPDATE plans SET monthly_budget_micro_usd = 60000000 WHERE id = 'team';
```

Integer micro-dollars avoid floating-point drift in sums. The budget is a cost figure, not a price: it is how much of the plan's revenue you are willing to spend on the model. Our post on [pricing an AI SaaS plan](/blog/price-ai-saas-plan-margins/) shows how to derive it from the margin you want.

## Check the worst case before each call

Checking what a user has *already* spent is not enough, because the request you are about to make could be large. Estimate its worst-case cost and check that it fits:

```ts
function worstCaseMicroUsd(price: PriceRow, inputTokens: number, maxTokens: number) {
  // Assume nothing is cached and the model uses all of max_tokens.
  return Math.ceil(
    (inputTokens * price.inputPerMtok + maxTokens * price.outputPerMtok) / 1_000_000,
  );
}
```

For `inputTokens`, you have two options:

- **Count exactly** with `client.messages.countTokens({ model, system, tools, messages })`. It is accurate for the model you pass, but it is an extra round trip with its own rate limits.
- **Estimate** from the previous turn's usage. In an agent loop, the next request is the last request plus what was appended, so `input + cache_read + cache_write` from the last response plus a margin for the new message is close enough for a budget check.

Do not estimate with an OpenAI tokenizer library. Claude tokenizes differently, and those libraries undercount.

`max_tokens` is the lever you control. A chat route that caps output at 4,096 tokens has a much smaller worst case than one that allows 64,000. Set it per route, from what the route actually needs.

## The race: two requests, one budget

Here is the naive check:

```ts
const spent = await spentThisMonth(userId);           // SELECT sum(cost_micro_usd) ...
if (spent + worstCase > budget) throw new BudgetError();
await callModel();                                    // takes 10–60 seconds
await recordUsage(userId, usage);                     // INSERT ...
```

Between the SELECT and the INSERT there are tens of seconds. Open five tabs, send five messages, and all five checks see the same `spent`. With an agent that runs for a minute per request, a script can start dozens of runs before the first one records anything.

The fix is a **reservation**: hold the worst case against the budget before the call, and replace it with the real cost after.

```sql
CREATE TABLE spend_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_micro_usd bigint NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);
CREATE INDEX ON spend_reservations (user_id);
```

```ts
async function reserve(userId: string, amount: number, budget: number) {
  return db.transaction(async (tx) => {
    // Serialise reservations per user: concurrent requests wait here, one at a time.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    const [{ used }] = await tx.execute(sql`
      SELECT
        coalesce((SELECT sum(cost_micro_usd) FROM usage_events
                  WHERE user_id = ${userId} AND created_at >= date_trunc('month', now())), 0)
      + coalesce((SELECT sum(amount_micro_usd) FROM spend_reservations
                  WHERE user_id = ${userId} AND expires_at > now()), 0) AS used`);
    if (Number(used) + amount > budget) return null;
    const [r] = await tx.execute(sql`
      INSERT INTO spend_reservations (user_id, amount_micro_usd)
      VALUES (${userId}, ${amount}) RETURNING id`);
    return r.id as string;
  });
}
```

After the call, in one transaction: insert the usage row with the real cost and delete the reservation. If the process crashes, `expires_at` releases the hold on its own; set it longer than your longest request.

The advisory lock is per user, so it only serialises one user's concurrent requests, and only for the few milliseconds of the check. Everyone else is unaffected.

## In an agent loop, check every turn

An agent run is several requests. Reserve before each one, not once per run, because a run's cost is only known as it goes. When a reservation fails mid-run, stop cleanly: keep the turns that completed, and send the client a clear event ("monthly AI budget reached") instead of a generic error. The user should see what happened and what upgrading would change.

## What the user sees

A budget that users cannot see feels like a bug when it triggers. Show it:

- On the usage page: spent this month, the plan's budget, and the reset date. Show it as a percentage or as "requests left at your average size" if you prefer not to show dollar figures.
- An in-app warning at 80%.
- A clear block at 100%, with the upgrade path and the reset date.

## The last line of defence

Per-user budgets protect your margin. They do not protect you from a bug in the budget code, a leaked API key or a runaway background job. Add two more limits outside your application:

1. **A global daily ceiling in your app**: if total spend today is more than, say, three times the 7-day average, pause free-plan traffic and alert yourself.
2. **A spend limit on the Anthropic side.** Set a monthly limit in the Claude Console for the workspace your production key belongs to. It is the only limit that still works when your own code is wrong.

## Summary

- Cap the sum of cost per usage row, not tokens.
- Check the worst case (input tokens × input price + `max_tokens` × output price) before each call.
- Use a per-user reservation with an advisory lock, or parallel requests will pass the check together.
- Reserve per turn in an agent loop and stop cleanly when the budget runs out.
- Show the budget to the user, and keep a spend limit in the Console as the final backstop.

<!-- site-only -->

*Agentwright Starter stores a micro-dollar cost on every usage row and checks the plan cap before every agent turn. Its built-in cap counts tokens; this post is the change we recommend if your plans mix models. It launches in December 2026; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's pricing and token counting documentation before publishing.*

<!-- /site-only -->
