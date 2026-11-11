---
title: "Catch a runaway AI bill before the invoice: spend anomaly alerts for LLM costs with SQL and a daily cron"
description: "Three cheap alerts for a Claude-based SaaS, built on your own usage table: a daily total against a budget, a per-user spike against that user's own history, and an hourly burn-rate check, plus the provider-side spending limit as the last safety net."
date: 2026-12-03
slug: spend-anomaly-alerts-llm-costs-sql
tags: [postgres, ai, saas, monitoring]
---

<p class="lede">The scary AI bill rarely comes from growth. It comes from one thing going wrong: a user's script calling your agent in a loop, a bug that resends a long conversation on every retry, a tool that returns a 200 KB page into the context. Per-user limits stop most of these, but limits have gaps, and the ones you forgot are the ones that hurt. Alerts are the second line: they tell you within hours, not at the end of the month.</p>

This post assumes a usage table with one row per model call, as in [metering costs per user](/blog/meter-claude-api-costs-per-user-nextjs/), with `user_id`, `created_at` and `cost_micro_usd` (the cost in millionths of a dollar, computed from a [price snapshot](/blog/snapshot-llm-prices-per-request/)). The SQL is plain Postgres.

## Alert 1: the daily total

The simplest alert, and the one to set up first: did yesterday cost more than you planned?

```sql
SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
       round((sum(cost_micro_usd) / 1e6)::numeric, 2) AS spend_usd,
       count(DISTINCT user_id) AS users
FROM usage_events
WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '1 day') AT TIME ZONE 'UTC'
  AND created_at <   date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
GROUP BY 1;
```

Pick the threshold from your budget, not from history: if you can afford $300 a month on API costs, a day over $10 deserves a look. Alert on a fixed number first; it is easy to understand and hard to argue with at 7 a.m.

Note the `AT TIME ZONE 'UTC'` pairs. Usage-based bills are usually cut by UTC day. `now() AT TIME ZONE 'UTC'` gives the current UTC wall-clock time, `date_trunc` cuts it to midnight, and the second `AT TIME ZONE 'UTC'` turns that midnight back into a `timestamptz`, so the comparison with `created_at` is exact and can still use an index. Leave out the second one and Postgres reads the boundary in the session's time zone, which may not be UTC.

## Alert 2: one user far above their normal

A daily total hides a single user going wild while overall traffic is low. Compare each user's spend in the last 24 hours with their own median day over the previous two weeks:

```sql
WITH daily AS (
  SELECT user_id, date_trunc('day', created_at) AS day, sum(cost_micro_usd) / 1e6 AS spend
  FROM usage_events
  WHERE created_at >= now() - interval '15 days' AND created_at < now() - interval '1 day'
  GROUP BY 1, 2
),
baseline AS (
  SELECT user_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY spend) AS median_day
  FROM daily GROUP BY 1
),
last24 AS (
  SELECT user_id, sum(cost_micro_usd) / 1e6 AS spend, count(*) AS calls
  FROM usage_events WHERE created_at >= now() - interval '24 hours'
  GROUP BY 1
)
SELECT l.user_id, round(l.spend::numeric, 2) AS last24_usd, l.calls,
       round(coalesce(b.median_day, 0)::numeric, 2) AS median_day_usd
FROM last24 l LEFT JOIN baseline b USING (user_id)
WHERE l.spend > greatest(5 * coalesce(b.median_day, 0), 2.00)   -- 5x normal AND at least $2
ORDER BY l.spend DESC
LIMIT 20;
```

The `greatest(..., 2.00)` floor matters. Without it, a user who usually spends 3 cents and today spent 20 cents fires an alert every morning, and within a week you stop reading them. New users have no baseline, so they are compared with the floor only.

Days with no usage do not appear in `daily`, so the median is over active days. That is what you want: "is this a normal working day for them?", not "is this more than their average including weekends off?".

## Alert 3: burn rate in the last hour

Daily checks find a problem the next morning. A loop that costs $40 an hour can do real damage by then. A cheap hourly check catches it:

```sql
SELECT round((sum(cost_micro_usd) / 1e6)::numeric, 2) AS last_hour_usd, count(*) AS calls,
       count(DISTINCT user_id) AS users
FROM usage_events
WHERE created_at >= now() - interval '1 hour';
```

Alert when the last hour is above a fixed ceiling, such as a tenth of your daily threshold times three. Also look at `calls`: a jump in calls with the same number of users usually means a client is retrying in a loop, which the [retries post](/blog/claude-api-errors-retries-agent-loop/) explains how to avoid on your own side.

An index on `usage_events (created_at)` keeps all three queries fast; the per-user query benefits from `(user_id, created_at)`, which you probably already have for spend limits.

## Running the checks

Any scheduler works: Vercel Cron, a GitHub Actions schedule, or a Cloudflare Worker cron trigger calling a protected route.

```ts
// app/api/cron/spend-alerts/route.ts
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const problems = [
    ...(await dailyTotalOver(Number(process.env.ALERT_DAILY_USD ?? 10))),
    ...(await usersAboveBaseline()),
    ...(await lastHourOver(Number(process.env.ALERT_HOURLY_USD ?? 3))),
  ];
  if (problems.length) await sendAlert(problems);   // email, Slack webhook, anything you read
  return Response.json({ problems: problems.length });
}
```

Three practical rules:

- **Send nothing on a good day.** An alert channel with daily "all fine" messages gets muted.
- **Put the next action in the alert:** the user ID, a link to their page in your admin, and the top models they used. At 7 a.m. nobody wants to write SQL.
- **Run the cron route with a database role that can read all users.** If you use [row-level security](/blog/postgres-row-level-security-multi-tenant-agent-saas/), the normal app role would see nothing and every check would pass.

## What to do when one fires

For a single user: look at their recent requests (conversation length, tool outputs, request rate). If it is abuse or a bug in their client, lower their limit or pause them; the [spend limit](/blog/per-user-spend-limits-in-dollars/) check can read a per-user override. If it is a real heavy user, that is a pricing question, and the [most expensive users query](/blog/find-most-expensive-users-sql/) and [plan margins post](/blog/price-ai-saas-plan-margins/) help answer it.

For a global spike with no single user: check the last deploy first. A prompt that grew, a removed cache breakpoint, or a model change on a busy route can each move the whole bill. A drop in cache reads in your usage rows is a strong hint that [prompt caching](/blog/prompt-caching-claude-agent-loop/) broke.

## The last safety net

Your alerts depend on your own metering being right. Set a monthly spend limit in the Anthropic Console as well, a little above what you expect to spend. If everything else fails, the API stops accepting requests instead of running up a bill. That is an outage, but a bounded one, and it is easier to explain than an invoice.

## Summary

- Alert 1: yesterday's total against a fixed budget number.
- Alert 2: users above 5x their own median day, with a dollar floor so small users don't trigger it.
- Alert 3: the last hour's spend and call count, to catch loops the same day.
- Run them from a cron route with a secret, send only when something is wrong, and include links to act on.
- Keep the provider's monthly spend limit as the final stop.

<!-- site-only -->

*Agentwright Starter records one usage row per model call with a price snapshot and has a `/usage` view on top of it, so these queries run on data you already have. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against the PostgreSQL documentation before publishing.*

<!-- /site-only -->
