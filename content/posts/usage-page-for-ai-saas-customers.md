---
title: "The usage page an AI SaaS needs: what to show customers so the bill never surprises them"
description: "What a customer-facing usage page for a Claude-based product should show: units customers understand instead of raw tokens, progress against the plan cap, a month-end projection, the most expensive conversations, 80% and 100% warnings, and the SQL behind each part."
date: 2026-12-22
slug: usage-page-for-ai-saas-customers
tags: [saas, postgres, nextjs, ai]
---

<p class="lede">Usage-based limits create one predictable support email: "Why did I hit my limit already?" The best answer is a page the customer can open before they write. A good usage page turns your metering rows into a few numbers a non-technical customer understands, warns before the cap, and points at what used the most. This post describes that page and the queries behind it.</p>

## Pick the unit customers see

Your database counts tokens and micro-dollars. Most customers do not think in tokens. Choose one unit for the page and use it everywhere, including the pricing page and emails:

- **Messages or tasks** ("212 of 500 messages this month"): easiest to understand, but unfair when one task costs 50 times another.
- **Credits**: one credit = a fixed amount of your cost, so heavy tasks use more credits. Fair and still simple, if the pricing page explains roughly what a credit buys.
- **Dollars of usage**: the most honest for developer audiences who know model prices; confusing for everyone else.
- **Tokens**: only for an audience of developers, and even then add a second unit next to it.

Whatever you show, the cap must be in the same unit. "1,240,000 tokens of 2,000,000" next to a plan that says "500 messages" is what generates the email.

## The five parts of the page

### 1. Progress against the cap

One bar, one sentence: "62% of this month's allowance used. Resets on 1 January." Include the reset date in the customer's timezone; a UTC midnight reset surprises people in Asia and America alike.

```sql
SELECT coalesce(sum(cost_micro_usd), 0) AS used_micro_usd
FROM usage_events
WHERE user_id = $1 AND created_at >= date_trunc('month', now());
```

### 2. A month-end projection

"At your current pace you will use about 140% of your allowance by 31 December" is the sentence that sells upgrades without a sales email. A simple projection is enough:

```ts
const dayOfMonth = now.getUTCDate() + now.getUTCHours() / 24;
const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
const projected = dayOfMonth >= 3 ? used * (daysInMonth / dayOfMonth) : null;   // too noisy before day 3
```

Show it only when it says something: hide it below 50% projected, and never show a projection from one day of data.

### 3. A daily chart for the last 30 days

Bars per day make spikes visible ("the 14th was a big day"). Fill missing days with zero, or the chart lies by skipping them:

```sql
SELECT d::date AS day, coalesce(sum(u.cost_micro_usd), 0) AS cost
FROM generate_series(current_date - 29, current_date, interval '1 day') d
LEFT JOIN usage_events u
  ON u.user_id = $1 AND u.created_at >= d AND u.created_at < d + interval '1 day'
GROUP BY d ORDER BY d;
```

### 4. What used the most

The most useful part, and the one most usage pages leave out: the conversations (or tasks, or API keys) that cost the most this month, with a link to each.

```sql
SELECT c.id, c.title, sum(u.cost_micro_usd) AS cost, count(*) AS model_calls
FROM usage_events u JOIN conversations c ON c.id = u.conversation_id
WHERE u.user_id = $1 AND u.created_at >= date_trunc('month', now())
GROUP BY c.id, c.title
ORDER BY cost DESC LIMIT 5;
```

That needs a `conversation_id` on each usage row. If you do not have one yet, add it now; it is also what your own [cost investigations](/blog/find-most-expensive-users-sql/) need. When a customer sees that one 40-turn conversation with a large PDF used a third of their month, they understand the bill and usually change how they work.

### 5. Plan and upgrade

Current plan, what the next plan includes, and one button. Put it on this page, not only on the pricing page: this is where the customer is when they need it.

## Warn before the cap, by email and in the app

Two thresholds cover it:

- **80%:** a banner in the app and one email ("You have used 80% of this month's allowance").
- **100%:** a clear message where the request was refused, with the reset date and the upgrade path, and one email.

Send each email once per month. A `usage_notices` table with `(user_id, month, threshold)` as its primary key makes that idempotent: insert first, send only if the insert succeeded. The [onboarding emails post](/blog/onboarding-emails-ai-saas-resend/) covers sending through Resend.

## Make it fast

A usage page that takes three seconds to load teaches customers not to check it. With an index on `(user_id, created_at)` these queries stay fast for a long time. When a single customer reaches millions of rows, add a daily rollup table filled by a nightly job and read the current day from the raw rows.

## Keep it honest

- Show the same numbers your limit check uses. If the page says 62% and the request is refused, you have two sources of truth; read both from one function.
- Include everything the customer pays for: tool costs such as [web search](/blog/claude-web-search-tool-agent-saas/) count too, if they count against the cap.
- If usage is recorded with a delay (batch jobs, background runs), say "updated a few minutes ago" rather than implying real time.

## Summary

- Show one unit customers understand, and the cap in the same unit.
- Progress bar with the reset date, a month-end projection, a 30-day chart, the top five conversations, and the upgrade path.
- Warn at 80% and at 100%, in the app and once by email.
- Read the page and the limit check from the same function.

<!-- site-only -->

*Agentwright Starter ships a `/usage` page with tokens and cost against the plan cap, a split by model, a 30-day chart and the latest calls, read from the same usage rows its cap check uses. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
