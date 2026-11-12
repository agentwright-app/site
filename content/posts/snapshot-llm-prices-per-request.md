---
title: "Model prices change. Snapshot them on every usage row"
description: "If you recompute last month's Claude API costs with today's price table, the totals move. Store the rate used on each request, version your price table, and keep raw token counts so a re-price is a deliberate step. Drizzle + Postgres code included."
date: 2026-11-04
slug: snapshot-llm-prices-per-request
tags: [claude, billing, postgres, typescript]
---

<p class="lede">A reader asked a sharp question under our post on <a href="/blog/meter-claude-api-costs-per-user-nextjs/">metering Claude API costs per user</a>: model prices change, so do you store the rate you used on each row, or look it up at report time? This post is the long answer.</p>

The short answer: **compute the cost when the request happens, store it, and also store which prices you used.** If you only store tokens and multiply by a price table at report time, every price change silently rewrites your history.

## The bug you get by looking prices up later

Say a user made 2,000 requests in October on Claude Sonnet 5.5, averaging 6,000 input and 800 output tokens each. At $2 input and $10 output per million tokens, that month cost:

```
input:  2,000 × 6,000 × $2  / 1e6 = $24.00
output: 2,000 ×   800 × $10 / 1e6 = $16.00
total                              = $40.00
```

You bill them, or count it against their plan cap. In December you update your price table, for example because you moved that user to a different model, fixed a cache-pricing mistake, or the list price changed. Now someone opens the October usage page, and the page recomputes the month with December's table. The total is no longer $40.

That causes three concrete problems:

1. **Invoices and dashboards disagree.** The customer was charged $40 but their usage page now says something else. That is a support ticket at best and a chargeback at worst.
2. **Margins look wrong after the fact.** Your own reports for past months change every time the table does, so you can't compare months.
3. **Caps become inconsistent.** If a plan cap is in dollars, a mid-month price change makes the same history count differently against it.

It sounds like an edge case, but it isn't one. Price tables change more often than you expect: new models, cache write tiers, long-context surcharges, batch discounts, and your own corrections. We fixed a wrong cache-read price in our own table shortly after writing it.

## Three things to store on every usage row

| Column | Why |
|---|---|
| Raw token counts (input, output, cache read, cache write) | The facts. They never change, so you can always re-price on purpose. |
| `cost_micro_usd` computed at write time | The number you bill and cap on. Summing it gives a stable total. |
| `price_id` (or the unit rates themselves) | Makes each charge auditable: you can show exactly which rates produced it. |

The first two make totals **reproducible**. The third makes them **explainable**. Without it you know the October total is $40, but if a customer asks why one request cost $0.02, you have to guess which version of the table was live that day.

## A versioned price table

Instead of a constant in code that you edit in place, keep prices as rows with an effective date. Old rows are never updated; a price change is a new row.

```ts
// lib/db/schema.ts
import { pgTable, text, integer, bigint, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";

export const modelPrices = pgTable(
  "model_prices",
  {
    id: text("id").primaryKey(), // e.g. "claude-sonnet-5-5@2026-11-01"
    model: text("model").notNull(),
    // Rates in micro-dollars per million tokens, so 2 USD/MTok = 2_000_000.
    inputPerMtok: bigint("input_per_mtok", { mode: "number" }).notNull(),
    outputPerMtok: bigint("output_per_mtok", { mode: "number" }).notNull(),
    cacheReadPerMtok: bigint("cache_read_per_mtok", { mode: "number" }).notNull(),
    cacheWritePerMtok: bigint("cache_write_per_mtok", { mode: "number" }).notNull(),
    effectiveFrom: timestamp("effective_from").notNull(),
    source: text("source").notNull(), // where the numbers came from
  },
  (t) => [uniqueIndex("model_prices_model_from_idx").on(t.model, t.effectiveFrom)],
);
```

Storing rates as integers in micro-dollars per million tokens keeps all the math in integers, the same reason we store costs in micro-dollars rather than floats.

Seed it with the current list prices from the [official pricing page](https://platform.claude.com/docs/en/about-claude/pricing):

```ts
// scripts/seed-prices.ts
const usd = (n: number) => Math.round(n * 1e6);
const from = new Date("2026-11-01T00:00:00Z");
const source = "platform.claude.com/docs/en/about-claude/pricing, checked 2026-11-01";

await db.insert(modelPrices).values([
  { id: "claude-opus-5-5@2026-11-01", model: "claude-opus-5-5", inputPerMtok: usd(4), outputPerMtok: usd(20), cacheReadPerMtok: usd(0.2), cacheWritePerMtok: usd(5), effectiveFrom: from, source },
  { id: "claude-sonnet-5-5@2026-11-01", model: "claude-sonnet-5-5", inputPerMtok: usd(2), outputPerMtok: usd(10), cacheReadPerMtok: usd(0.1), cacheWritePerMtok: usd(2.5), effectiveFrom: from, source },
  { id: "claude-haiku-5-5@2026-11-01", model: "claude-haiku-5-5", inputPerMtok: usd(0.1), outputPerMtok: usd(0.5), cacheReadPerMtok: usd(0.01), cacheWritePerMtok: usd(0.125), effectiveFrom: from, source },
]).onConflictDoNothing();
```

The cache write rates above are the 5-minute tier. If you use 1-hour cache writes or send Haiku prompts over 100k tokens, those have their own rates and deserve their own columns or rows.

## Snapshot at write time

The usage table gains one column, `price_id`, next to the cost it already has:

```ts
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull(),
    priceId: text("price_id").notNull().references(() => modelPrices.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("usage_events_user_created_idx").on(t.userId, t.createdAt)],
);
```

Recording a request looks up the price row that was in effect at that moment, computes the cost and writes both:

```ts
// lib/billing/metering.ts
import { and, desc, eq, lte } from "drizzle-orm";

type Usage = { input: number; output: number; cacheRead?: number; cacheWrite?: number };
type Price = typeof modelPrices.$inferSelect;

export async function currentPrice(model: string, at = new Date()): Promise<Price> {
  const [row] = await db
    .select()
    .from(modelPrices)
    .where(and(eq(modelPrices.model, model), lte(modelPrices.effectiveFrom, at)))
    .orderBy(desc(modelPrices.effectiveFrom))
    .limit(1);
  if (!row) throw new Error(`No price for ${model} at ${at.toISOString()}`);
  return row;
}

export function costMicroUsd(p: Price, u: Usage): number {
  // tokens × (micro-dollars per million tokens) / 1e6 = micro-dollars
  const total =
    u.input * p.inputPerMtok +
    u.output * p.outputPerMtok +
    (u.cacheRead ?? 0) * p.cacheReadPerMtok +
    (u.cacheWrite ?? 0) * p.cacheWritePerMtok;
  return Math.round(total / 1e6);
}

export async function recordUsage(userId: string, model: string, u: Usage) {
  const price = await currentPrice(model);
  await db.insert(usageEvents).values({
    userId,
    model,
    inputTokens: u.input,
    outputTokens: u.output,
    cacheReadTokens: u.cacheRead ?? 0,
    cacheWriteTokens: u.cacheWrite ?? 0,
    costMicroUsd: costMicroUsd(price, u),
    priceId: price.id,
  });
}
```

Two details matter here:

- **Throw on a missing price.** An unknown model should fail loudly in development, not get recorded as free. In production you may prefer to record the tokens with a sentinel price and alert, so a user's request doesn't fail because your table is behind.
- **Cache the lookup.** The price table changes a few times a year. Reading it once per process (or once a minute) is fine; you don't need a query per request.

A month's total is now just a sum, and it never moves:

```sql
select sum(cost_micro_usd) / 1e6 as usd
from usage_events
where user_id = $1
  and created_at >= date_trunc('month', now());
```

## Changing a price

When a price changes, you insert a row and touch nothing else:

```ts
await db.insert(modelPrices).values({
  id: "claude-sonnet-5-5@2027-01-15",
  model: "claude-sonnet-5-5",
  inputPerMtok: usd(1.5), // hypothetical new price, for the example only
  outputPerMtok: usd(7.5),
  cacheReadPerMtok: usd(0.075),
  cacheWritePerMtok: usd(1.875),
  effectiveFrom: new Date("2027-01-15T00:00:00Z"),
  source: "pricing page, checked 2027-01-15",
});
```

Requests before January 15 keep their old cost and old `price_id`. Requests after use the new row. You can even insert the row in advance when a price change is announced, and it takes effect on the date by itself.

## Re-pricing on purpose

Sometimes you do want to change history: your table had a wrong number, like our cache-read price. Because the raw tokens are kept, this is an explicit migration rather than an accident:

```sql
-- Re-price rows that used a wrong price row, and point them at the fixed one.
update usage_events u
set cost_micro_usd = round((
      u.input_tokens        * p.input_per_mtok
    + u.output_tokens       * p.output_per_mtok
    + u.cache_read_tokens   * p.cache_read_per_mtok
    + u.cache_write_tokens  * p.cache_write_per_mtok
  ) / 1e6),
  price_id = p.id
from model_prices p
where u.price_id = 'claude-sonnet-5-5@2026-11-01'
  and p.id = 'claude-sonnet-5-5@2026-11-01-fixed';
```

Run it in a transaction, check the before and after totals per user, and decide whether to refund or credit anyone. If invoices were already sent, keep the original rows and write an adjustment instead, so your records match what customers actually paid.

## Check against your real bill

Your own numbers are an estimate of what the API provider charges you. Once a month, compare the sum of `cost_micro_usd` across all users with the cost shown in the Claude Console for the same period. A small gap is normal (rounding, requests that failed after tokens were billed, test traffic from your own keys). A large gap usually means a missing cache column, a model you forgot to add, or a price row that is out of date.

## If you don't want a price table in the database

The minimum version is two extra columns on each usage row: the unit rates used, as plain numbers, or a `pricing_version` string that matches a constant in your code. It is less queryable, but it still answers the question "which prices produced this charge" for every row, and that is the part that matters.

## Summary

- Compute the cost when the request happens and store it. Sum stored costs for totals.
- Store which prices you used (`price_id` or the rates), so each charge can be explained.
- Keep raw token counts, so re-pricing is a deliberate, reviewable migration.
- Treat price changes as new rows with an effective date, never as edits.

Thanks to the reader on DEV whose comment prompted this post.

---

<!-- site-only -->

*Update, 2026-11-04: this now ships in Agentwright Starter 0.4.0. Every usage row stores tokens, the write-time cost and a `price_id` pointing at a versioned `model_prices` table (including the Haiku 5.5 long-context tier), and the `/usage` page lists the price versions behind each month's total. Agentwright Starter is a Next.js starter kit for Claude-powered SaaS with auth, Lemon Squeezy billing, MCP tools and evals already wired together, launch price $99. Details are at [agentwright.app](https://agentwright.app) and in the [FAQ](/faq/).*

<!-- /site-only -->

<!-- site-only -->

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed against the code and the official pricing page before publishing.*

<!-- /site-only -->
