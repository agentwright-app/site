---
title: "Rate limiting an LLM endpoint with only Postgres: per-plan limits, 429s and why requests per minute is not enough"
description: "A sliding-window rate limiter for a Next.js AI endpoint that needs no Redis: one table, one indexed count, per-plan limits, standard rate-limit headers. Plus the second limit every AI product needs, a monthly token or cost cap."
date: 2026-11-08
slug: rate-limit-llm-endpoints-postgres
tags: [nextjs, postgres, ai, saas]
---

<p class="lede">An AI endpoint without a rate limit is an open tab on your API bill. One script, one stuck retry loop or one enthusiastic free user can spend in an afternoon what a paying customer brings in all month. This post builds a per-plan limiter that runs on the Postgres you already have, and explains why it is only half of the protection you need.</p>

The code is TypeScript with Drizzle, for a Next.js route handler, but the SQL is the part that matters and ports anywhere.

## Two different limits

AI products need two limits that protect against different things:

| Limit | Protects against | Typical unit |
|---|---|---|
| Rate limit | Bursts: scripts, retry storms, abuse | Requests per minute |
| Usage cap | Slow overspend: a user who is simply heavy | Tokens or dollars per month |

A rate limit of 10 requests per minute still allows 14,400 requests a day. If each one is a 6,000-token agent run, that is a lot of money from a user who never once hit the limit. So the rate limit stops bursts, and the monthly cap (covered at the end) stops the bill.

## Why Postgres and not Redis

Redis is the usual answer, and at high volume it is the right one. But a starter-scale SaaS runs on one database, and an AI request already takes seconds. One indexed count query adds about a millisecond to a request that spends several seconds waiting on the model. Adding a second datastore to save that millisecond is a poor trade until you have the traffic to justify it. Keep the limiter behind a small interface and you can swap the storage later without touching callers.

## The table

```ts
export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull(),                 // "user:<id>", or "ip:<hash>" for anonymous routes
    bucket: text("bucket").notNull().default("agent"),  // "agent", "upload", ...: one limit per feature
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("rate_limit_hits_subject_bucket_created_idx").on(t.subject, t.bucket, t.createdAt)],
);
```

One row per allowed request. The composite index on `(subject, bucket, created_at)` is what makes the count cheap: the query reads only the index entries for one user in one bucket over the last minute, never the whole table.

## A sliding window, not a fixed one

A fixed window ("10 per calendar minute") lets a user send 10 requests at 12:00:59 and 10 more at 12:01:00, 20 in two seconds. A sliding window counts the requests in the last 60 seconds from now, so the limit holds at every moment.

```ts
export const WINDOW_MS = 60_000;

export async function checkRateLimit(subject: string, limit: number, bucket = "agent") {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const inWindow = and(eq(rateLimitHits.subject, subject), eq(rateLimitHits.bucket, bucket), gte(rateLimitHits.createdAt, windowStart));

  const [, [{ used }], [oldest]] = await Promise.all([
    // Prune this subject's expired rows: cheap with the index, and no cleanup job needed.
    db.delete(rateLimitHits).where(and(eq(rateLimitHits.subject, subject), eq(rateLimitHits.bucket, bucket), lt(rateLimitHits.createdAt, windowStart))),
    db.select({ used: count() }).from(rateLimitHits).where(inWindow),
    db.select({ at: sql<Date>`min(${rateLimitHits.createdAt})` }).from(rateLimitHits).where(inWindow),
  ]);

  const resetAt = new Date((oldest?.at ? new Date(oldest.at) : now).getTime() + WINDOW_MS);
  const retryAfterSec = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));

  if (Number(used) >= limit) return { ok: false, limit, remaining: 0, retryAfterSec, resetAt };

  await db.insert(rateLimitHits).values({ subject, bucket });
  return { ok: true, limit, remaining: Math.max(0, limit - Number(used) - 1), retryAfterSec: 0, resetAt };
}
```

Details that matter:

- **Rejected requests are not recorded.** Only allowed requests insert a row, so a client that keeps hammering after a 429 does not extend its own lockout forever. Whether that is what you want is a product choice; for paying users it is the friendlier one.
- **`Retry-After` comes from the oldest hit in the window.** That is the exact moment one slot frees up, so the client can wait precisely instead of guessing.
- **Pruning happens inline**, scoped to one subject, so the table stays small without a cron job.

**The race.** Two requests from the same user that arrive in the same millisecond can both count 9 and both insert, so the user gets 11 instead of 10. For a per-minute limit on an endpoint that takes seconds, being off by one under a race is harmless. If you need it exact (credits, not rate limits), use a transaction with `SELECT ... FOR UPDATE` on a per-user row, or Postgres advisory locks.

## Limits per plan

Store the limit on the plan, so an upgrade takes effect on the next request without a deploy:

```ts
export const DEFAULT_LIMITS: Record<string, number> = { free: 10, pro: 60, team: 200 };

export async function limitForPlan(planId: string) {
  const [plan] = await db.select({ rpm: plans.requestsPerMinute }).from(plans).where(eq(plans.id, planId));
  return plan?.rpm ?? DEFAULT_LIMITS[planId] ?? DEFAULT_LIMITS.free;
}
```

The fallback map keeps a fresh install working before the plans table is seeded. Unknown plans fall back to the free limit, never to "unlimited".

## Wiring it into the route

Check the limit **before** you parse the body or touch the model, so a rejected request costs one query and nothing else:

```ts
export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkRateLimit(`user:${user.id}`, await limitForPlan(user.plan));
  if (!rl.ok) {
    return Response.json(
      { error: "Too many requests", code: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }
  // ...run the agent, and include rateLimitHeaders(rl) on the success response too
}

export function rateLimitHeaders(r: { ok: boolean; limit: number; remaining: number; retryAfterSec: number; resetAt: Date }) {
  const h: Record<string, string> = {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(Math.ceil(r.resetAt.getTime() / 1000)),
  };
  if (!r.ok) h["Retry-After"] = String(r.retryAfterSec);
  return h;
}
```

Sending the headers on successful responses too lets a well-behaved client slow down before it hits the wall. In the UI, turn a 429 into a sentence with a number in it ("Try again in 23 seconds, or upgrade for a higher limit") rather than a generic error.

Use separate buckets for features with different costs. A file upload that triggers an expensive analysis should not share a budget with a cheap autocomplete call.

## The other half: a monthly cap

The rate limit does nothing about a user who sends 9 requests a minute all day. For that, check accumulated usage before each model call:

```ts
export async function assertWithinCap(userId: string) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [plan] = await db.select().from(plans).where(eq(plans.id, user.plan));
  const [{ used }] = await db
    .select({ used: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, monthStart)));

  if (Number(used) >= plan.monthlyTokenCap && !plan.overageAllowed) {
    throw Object.assign(new Error("Monthly token cap reached. Upgrade your plan to continue."), { code: "CAP_REACHED" });
  }
}
```

Call it before **every turn** of an agent loop, not just once per request: a single agent run can make a dozen model calls. This relies on recording usage per call, which we covered in [How to meter Claude API costs per user](/blog/meter-claude-api-costs-per-user-nextjs/). Capping on cost (`sum(cost_micro_usd)`) instead of tokens is fairer when users can pick between models with very different prices.

<!-- site-only -->

How high to set the cap is a pricing question: the [AI SaaS margin calculator](/tools/ai-saas-margin-calculator/) shows how many requests a plan can include before it stops making money.

<!-- /site-only -->

## When to move to Redis

Move the limiter to Redis (or a managed service like Upstash) when one of these is true: the count query shows up in your slow-query log, you limit non-AI endpoints that answer in milliseconds, or you run many app instances in different regions far from the database. The return shape stays the same, so the route handler does not change.

<!-- site-only -->

*This limiter and the monthly cap ship in Agentwright Starter, wired into its streaming agent endpoint with plan limits seeded for free, pro and team. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed against the code before publishing.*

<!-- /site-only -->
