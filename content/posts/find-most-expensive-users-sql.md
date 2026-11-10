---
title: "Find your most expensive AI users with SQL: six queries for a usage table"
description: "Six Postgres queries over a per-request usage table that answer the questions an AI SaaS founder actually asks: who costs the most, who costs more than they pay, which model drives the bill, whether caching works, and whether today looks abnormal."
date: 2026-11-19
slug: find-most-expensive-users-sql
tags: [postgres, sql, saas, analytics]
---

<p class="lede">Once you record a row per model call, with tokens and a cost, you have everything you need to understand your AI bill. You do not need an analytics product for the first year; you need a handful of queries you can run in a SQL console on Monday morning. Here are six, each answering one question, written for a plain Postgres table.</p>

All queries were run on PostgreSQL 16 against the table below. Costs are stored as integer micro-dollars ($1 = 1,000,000), so the queries divide by `1e6` only for display.

## The table

These queries assume one row per API response, as described in [metering Claude API costs per user](/blog/meter-claude-api-costs-per-user-nextjs/):

```sql
CREATE TABLE usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  model text NOT NULL,
  input_tokens int NOT NULL,
  output_tokens int NOT NULL,
  cache_read_tokens int NOT NULL DEFAULT 0,
  cache_write_tokens int NOT NULL DEFAULT 0,
  cost_micro_usd bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON usage_events (user_id, created_at);
```

`users` has an `email` and a `plan` column. Plan prices live in your billing provider, so the queries that need them use a small inline table you can edit.

## 1. Who cost the most this month?

```sql
SELECT u.email, u.plan,
       count(*)                              AS requests,
       round(sum(e.cost_micro_usd) / 1e6, 2) AS cost_usd,
       round(avg(e.cost_micro_usd) / 1e6, 4) AS avg_cost_per_request
FROM usage_events e
JOIN users u ON u.id = e.user_id
WHERE e.created_at >= date_trunc('month', now())
GROUP BY u.email, u.plan
ORDER BY cost_usd DESC
LIMIT 20;
```

Look at the two right-hand columns together. A user at the top because of many cheap requests is engaged. A user at the top with a high cost *per request* is usually sending huge inputs (whole documents, long histories) or running long agent tasks, and that is a product question, not a pricing one.

## 2. Who costs more than they pay?

```sql
WITH plan_prices(plan, monthly_usd) AS (
  VALUES ('free', 0), ('pro', 29), ('team', 99)
)
SELECT u.email, u.plan, p.monthly_usd,
       round(sum(e.cost_micro_usd) / 1e6, 2) AS cost_usd,
       round(100 * sum(e.cost_micro_usd) / 1e6 / nullif(p.monthly_usd, 0), 1) AS cost_pct_of_price
FROM usage_events e
JOIN users u ON u.id = e.user_id
JOIN plan_prices p ON p.plan = u.plan
WHERE e.created_at >= date_trunc('month', now())
GROUP BY u.email, u.plan, p.monthly_usd
HAVING sum(e.cost_micro_usd) / 1e6 > 0.5 * p.monthly_usd
ORDER BY cost_pct_of_price DESC NULLS FIRST;
```

This lists everyone whose API cost is over half their plan price (free users with any meaningful cost appear first, because their percentage is undefined). Payment processing fees come on top, so the real margin is lower than this shows. If this list grows every month, the plan's cap is too loose; our post on [pricing an AI SaaS plan](/blog/price-ai-saas-plan-margins/) shows how to set it.

## 3. How concentrated is the cost?

```sql
WITH per_user AS (
  SELECT user_id, sum(cost_micro_usd) AS cost
  FROM usage_events
  WHERE created_at >= date_trunc('month', now())
  GROUP BY user_id
), ranked AS (
  SELECT cost,
         ntile(10) OVER (ORDER BY cost DESC) AS decile
  FROM per_user
)
SELECT decile,
       count(*)                                           AS users,
       round(sum(cost) / 1e6, 2)                          AS cost_usd,
       round(100.0 * sum(cost) / sum(sum(cost)) OVER (), 1) AS pct_of_total
FROM ranked
GROUP BY decile
ORDER BY decile;
```

In most AI products the top 10% of users account for well over half the cost. That is normal. What you want to know is whether that decile is on your highest plan. If it is mostly on the entry plan, you are subsidising your heaviest users with everyone else's subscriptions.

## 4. Which model drives the bill?

```sql
SELECT model,
       count(*)                                     AS requests,
       round(sum(cost_micro_usd) / 1e6, 2)          AS cost_usd,
       round(100.0 * sum(cost_micro_usd) / sum(sum(cost_micro_usd)) OVER (), 1) AS pct_of_cost,
       round(avg(output_tokens))                    AS avg_output_tokens
FROM usage_events
WHERE created_at >= now() - interval '30 days'
GROUP BY model
ORDER BY cost_usd DESC;
```

If one model is 10% of requests and 60% of cost, that is the route to look at first. Sometimes it is right (a hard task on Claude Opus 5.5); sometimes it is a route that was set to a larger model during development and never changed. [Choosing a model per route](/blog/choose-claude-model-per-route/) covers how to decide.

## 5. Is prompt caching actually working?

```sql
SELECT u.email,
       sum(e.cache_read_tokens)  AS cache_read,
       sum(e.cache_write_tokens) AS cache_write,
       sum(e.input_tokens)       AS uncached_input,
       round(100.0 * sum(e.cache_read_tokens)
             / nullif(sum(e.cache_read_tokens + e.cache_write_tokens + e.input_tokens), 0), 1)
                                 AS cache_hit_pct
FROM usage_events e
JOIN users u ON u.id = e.user_id
WHERE e.created_at >= now() - interval '7 days'
GROUP BY u.email
HAVING count(*) >= 20
ORDER BY cache_hit_pct ASC
LIMIT 20;
```

The hit rate is cache reads as a share of all prompt tokens. A multi-turn agent with a stable system prompt usually sits well above 50%. Users near 0% with many requests point to something breaking the prefix: a timestamp in the system prompt, a tool list that changes order, or history being edited. Remove the `JOIN` and `GROUP BY u.email` to get the number for the whole app; it is the single best health metric for an agent's cost.

## 6. Does today look abnormal?

```sql
WITH daily AS (
  SELECT date_trunc('day', created_at) AS day, sum(cost_micro_usd) AS cost
  FROM usage_events
  WHERE created_at >= date_trunc('day', now()) - interval '7 days'
  GROUP BY 1
)
SELECT round((SELECT cost FROM daily WHERE day = date_trunc('day', now())) / 1e6, 2) AS today_usd,
       round(avg(cost) / 1e6, 2) AS avg_prev_7_days_usd
FROM daily
WHERE day < date_trunc('day', now());
```

Run this from a scheduled job and alert when today passes, say, three times the 7-day average before the day is over. It catches a runaway background job or an abused free account hours before the invoice does. Remember that `date_trunc('day', ...)` uses the database session's time zone; set it explicitly (`SET TIME ZONE 'UTC'`) if your team is spread across zones.

## Keeping it fast

With the `(user_id, created_at)` index, per-user queries stay fast for a long time. Whole-table monthly aggregates are fine into the low millions of rows. Past that, add a nightly rollup:

```sql
CREATE TABLE usage_daily (
  day date NOT NULL,
  user_id uuid NOT NULL,
  model text NOT NULL,
  requests int NOT NULL,
  cost_micro_usd bigint NOT NULL,
  cache_read_tokens bigint NOT NULL,
  prompt_tokens bigint NOT NULL,
  PRIMARY KEY (day, user_id, model)
);
```

Fill it once a day with `INSERT ... SELECT ... GROUP BY` for yesterday, and point queries 1 to 5 at it. Keep the raw table for disputes and debugging.

## Summary

- One row per API call with tokens and cost is enough for real cost analytics.
- Weekly: top users by cost, users over half their plan price, cost by model.
- Watch the cache hit rate; it is the best single health metric for agent cost.
- Alert on daily cost against the 7-day average.
- Roll up by day once the raw table gets large.

<!-- site-only -->

*Agentwright Starter records exactly this `usage_events` table (plus a `price_id` for the rate used), and its `/usage` page shows each user their own month. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude). Every query was run on PostgreSQL 16 before publishing.*

<!-- /site-only -->
