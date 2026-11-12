---
title: "How to meter Claude API costs per user in a Next.js SaaS (with code)"
description: "Record every Claude API call per user, convert tokens to dollars with the official Claude 5.5 prices, enforce plan caps, and show a usage page. Drizzle + Postgres + the Anthropic TypeScript SDK."
date: 2026-11-01
slug: meter-claude-api-costs-per-user-nextjs
tags: [claude, nextjs, billing, typescript]
---

If you charge users for an AI feature, you need to know what each of them costs you. Not in aggregate, on the Anthropic invoice at the end of the month, but per user, per request, in real time, so you can cap free accounts, show a usage page, and find out which 2% of users are 60% of your bill.

This post walks through the metering layer we use in [Agentwright Starter](https://agentwright.app): a Next.js app with Drizzle + Postgres and the official `@anthropic-ai/sdk`. Everything below is plain TypeScript you can drop into an existing project. The design is small on purpose: one table, one pure pricing module, two functions.

## What the API gives you

Every response from the Messages API carries a `usage` object. For a streaming request, the SDK's `finalMessage()` returns the assembled message with the same fields:

```ts
const stream = client.messages.stream({ model, max_tokens, system, tools, messages });
const final = await stream.finalMessage();

final.usage.input_tokens;                 // uncached input, billed at the base input price
final.usage.output_tokens;                // billed at the output price
final.usage.cache_read_input_tokens;      // served from the prompt cache (cheap)
final.usage.cache_creation_input_tokens;  // written to the prompt cache (slightly more than base)
```

Two things trip people up here.

First, the four numbers are billed at four different rates. If you only store `input_tokens + output_tokens`, your cost estimate will be wrong as soon as you enable prompt caching, which you should, because a cached system prompt plus tool definitions is the single biggest saving in an agent loop.

Second, an agent turn is not one request. A loop that calls a tool three times makes four API requests, and each one has its own `usage`. Meter per request, not per user message.

## The official prices (checked 2026-11-01)

These are the Claude API list prices from the [official pricing page](https://platform.claude.com/docs/en/about-claude/pricing), in USD per million tokens. Verify them yourself before copying; pricing pages change, and this table will not update itself.

| Model | Input | Output | Cache write (5 min) | Cache read |
|---|---|---|---|---|
| Claude Opus 5.5 | $4.00 | $20.00 | $5.00 | $0.20 |
| Claude Sonnet 5.5 | $2.00 | $10.00 | $2.50 | $0.10 |
| Claude Haiku 5.5 (prompt ≤ 100K tokens) | $0.10 | $0.50 | $0.125 | $0.01 |
| Claude Haiku 5.5 (prompt > 100K tokens) | $0.50 | $2.50 | $0.625 | $0.05 |

Notes that matter for metering:

- Cache reads on Opus 5.5 and Sonnet 5.5 are 5% of the base input price, not the 10% that older models use. Cache reads on Fable 5.1 are 2.5%. Do not hard-code "cache read = input / 10".
- The 5-minute cache write is 1.25x the base input price; the 1-hour write is 2x. The code below assumes the 5-minute TTL. If you use `ttl: "1h"`, add a separate rate.
- Haiku 5.5 is the only current model with a long-context tier. The whole request is priced at the higher tier when its prompt (including cache reads and writes) exceeds 100,000 tokens.
- Opus 5.5, Sonnet 5.5 and Haiku 5.5 all have a 1M-token context window, and apart from the Haiku tier above, there is no long-context surcharge.
- The Batch API is 50% off input and output. If you move background jobs to batches, meter them at half price.

## Step 1: a pure pricing module

Keep prices in a module with no database import, so your eval runner, a cost calculator in the browser, and the server can all use the same numbers. Store cost as an integer number of micro-dollars (1e-6 USD). Floating-point dollars in a `SUM()` look fine for a week and then drift.

```ts
// lib/billing/pricing.ts
export type ModelPrice = { in: number; out: number; cacheRead: number; cacheWrite: number };

/** USD per million tokens. Source: platform.claude.com/docs/en/about-claude/pricing */
export const PRICE_PER_MTOK: Record<string, ModelPrice> = {
  "claude-opus-5-5":   { in: 4,   out: 20,  cacheRead: 0.2,  cacheWrite: 5 },
  "claude-sonnet-5-5": { in: 2,   out: 10,  cacheRead: 0.1,  cacheWrite: 2.5 },
  // Prompts over 100K tokens are billed at the higher Haiku tier (see haikuPrice below).
  "claude-haiku-5-5":  { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

const HAIKU_LONG: ModelPrice = { in: 0.5, out: 2.5, cacheRead: 0.05, cacheWrite: 0.625 };

export type Usage = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

function priceFor(model: string, u: Usage): ModelPrice {
  const p = PRICE_PER_MTOK[model];
  if (!p) throw new Error(`Unknown model pricing: ${model}`);
  if (model === "claude-haiku-5-5") {
    const promptTokens = u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
    if (promptTokens > 100_000) return HAIKU_LONG;
  }
  return p;
}

/** Cost in micro-dollars (1e-6 USD) so it can be stored as a bigint. */
export function costMicroUsd(model: string, u: Usage): number {
  const p = priceFor(model, u);
  const usd =
    (u.input * p.in +
      u.output * p.out +
      (u.cacheRead ?? 0) * p.cacheRead +
      (u.cacheWrite ?? 0) * p.cacheWrite) / 1e6;
  return Math.round(usd * 1e6);
}

export function formatUsd(microUsd: number, digits = 4): string {
  return `$${(microUsd / 1e6).toFixed(digits)}`;
}
```

A quick sanity check: one Sonnet 5.5 request with 3,000 uncached input tokens, 8,000 cache-read tokens and 600 output tokens costs 3,000 × $2 + 8,000 × $0.10 + 600 × $10 = $6,000 + $800 + $6,000 per million, which is $0.0128. With `costMicroUsd` that is `12800`. Without caching the same prompt would have been 11,000 × $2 + 600 × $10 = $0.028, so the cache cut this request's cost by more than half. That is why you must meter cache reads separately: if you bill them as full input you will overcharge users and under-sell your own margins.

Throwing on an unknown model is deliberate. A silent `?? 0` means a new model ships, someone sets `AGENT_MODEL`, and every request is recorded as free.

## Step 2: one table

```ts
// lib/db/schema.ts (excerpt)
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("usage_events_user_created_idx").on(t.userId, t.createdAt)],
);

export const plans = pgTable("plans", {
  id: text("id").primaryKey(), // free | pro | team
  monthlyTokenCap: bigint("monthly_token_cap", { mode: "number" }).notNull(),
  overageAllowed: integer("overage_allowed").notNull().default(0),
});
```

One row per API request. Store the raw token counts and the computed cost. The raw counts let you re-price history if you discover a bug or Anthropic changes a price; the stored cost makes the usage page a single `SUM()`.

The composite index on `(user_id, created_at)` is the only one you need. Every query below is "this user, this month".

## Step 3: record and enforce

```ts
// lib/billing/metering.ts
import { db } from "@/lib/db";
import { usageEvents, users, plans } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { costMicroUsd, type Usage } from "./pricing";

export async function recordUsage(userId: string, model: string, u: Usage) {
  await db.insert(usageEvents).values({
    userId,
    model,
    inputTokens: u.input,
    outputTokens: u.output,
    cacheReadTokens: u.cacheRead ?? 0,
    cacheWriteTokens: u.cacheWrite ?? 0,
    costMicroUsd: costMicroUsd(model, u),
  });
}

export async function assertWithinCap(userId: string): Promise<void> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [plan] = await db.select().from(plans).where(eq(plans.id, user.plan));
  const [{ used }] = await db
    .select({
      used: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, monthStart)));

  if (Number(used) >= plan.monthlyTokenCap && !plan.overageAllowed) {
    const err = new Error("Monthly token cap reached. Upgrade your plan to continue.");
    (err as any).code = "CAP_REACHED";
    throw err;
  }
}
```

The cap here is in tokens, not dollars, because that is what users can reason about on a pricing page ("2 million tokens a month"). If you prefer dollar caps, sum `cost_micro_usd` instead; the table supports both.

One honest limitation: this check reads before the request and writes after it, so a user can exceed the cap by one request. For a chat product that is fine. If you need a hard ceiling, reserve an estimate before the call (count input tokens with `client.messages.countTokens` and assume `max_tokens` output), then reconcile after.

## Step 4: wire it into the agent loop

Metering goes around each request in the loop, not around the whole conversation:

```ts
// lib/agent/loop.ts (excerpt)
for (let turn = 0; turn < MAX_TURNS; turn++) {
  if (opts.userId) await assertWithinCap(opts.userId);

  const stream = client.messages.stream({
    model,
    max_tokens: opts.maxTokens ?? 8192,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    tools,
    messages,
  });
  stream.on("text", (t) => opts.onText?.(t));
  const final = await stream.finalMessage();

  if (opts.userId) {
    await recordUsage(opts.userId, model, {
      input: final.usage.input_tokens,
      output: final.usage.output_tokens,
      cacheRead: final.usage.cache_read_input_tokens ?? 0,
      cacheWrite: final.usage.cache_creation_input_tokens ?? 0,
    });
  }

  messages.push({ role: "assistant", content: final.content });
  if (final.stop_reason !== "tool_use") return messages;
  // ...execute tool calls, push results, continue
}
```

Making `userId` optional is a small thing that pays off: your eval runner and smoke tests can call the same loop without a database, and production always passes a user.

In the API route, catch `CAP_REACHED` and return something the client can act on. We stream server-sent events, so the route emits `{ event: "error", data: { code: "CAP_REACHED", message } }` and the chat UI shows an upgrade link instead of a generic failure.

## Step 5: the usage page

With cost already in the table, the per-user page is three aggregate queries. The one users look at most is cost by model this month:

```ts
const byModel = await db
  .select({
    model: usageEvents.model,
    requests: sql<number>`count(*)`,
    tokens: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)`,
    costMicroUsd: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)`,
  })
  .from(usageEvents)
  .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, monthStart)))
  .groupBy(usageEvents.model)
  .orderBy(desc(sql`sum(${usageEvents.costMicroUsd})`));
```

Postgres returns `sum()` as a string for bigint columns, so wrap results in `Number()` before sending them to the client. Add a daily series for the last 30 days (`date_trunc('day', created_at)`) and the 20 most recent requests, and you have everything a user needs to understand their bill. The same queries, without the `userId` filter, are your admin view.

## The mistakes to avoid

- **Metering only the final turn.** A tool-heavy conversation can make five requests for one user message. If you record one row per message, the bill looks several times cheaper than it is.
- **Treating cache reads as input.** On a well-cached agent prompt, most input tokens are cache reads at 5% to 10% of the base price. Billing them as full input overstates cost by a wide margin, and the multiplier differs per model.
- **Floats for money.** `SUM(cost_usd)` across a month happily produces `0.30000000000000004`. Integer micro-dollars avoid the problem entirely.
- **Treating prices as constants.** Keep the source URL and the check date next to the table, and re-check it when a model ships. Pricing is a dependency, not a fact.

## What this does not cover

Rate limiting (requests per minute per plan) is a separate concern and lives in its own table. Neither does this post cover overage billing: `overageAllowed` lets a plan continue past the cap, and a monthly job can sum `cost_micro_usd` and create a usage-based charge with your payment provider. The starter has the rate limiting and the `overageAllowed` flag; it does not charge for overage.

---

*Agentwright Starter is a Next.js starter kit for Claude-powered SaaS: GitHub and magic-link auth, the streaming agent loop above with tool calls and MCP, per-user metering and plan caps, Lemon Squeezy or Polar billing, an eval runner and a usage dashboard, already wired together. Launch price $99. Details are at [agentwright.app](https://agentwright.app).*
