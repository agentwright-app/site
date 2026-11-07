---
title: "Prepaid credits for an AI SaaS: a Postgres ledger, Lemon Squeezy top-ups and refunds that add up"
description: "How to sell prepaid usage credits for an AI product: when credits beat a subscription, an append-only credit ledger in Postgres, adding credits from a Lemon Squeezy order webhook, reserving and settling credits around each agent run, expiry, refunds, and the numbers to show users."
date: 2026-12-12
slug: prepaid-credits-ai-saas-postgres-ledger
tags: [postgres, billing, lemonsqueezy, pricing]
---

<p class="lede">A flat monthly plan works until usage varies a lot between users: one runs ten requests a month, another runs ten thousand. Prepaid credits fix the mismatch. Users buy a pack, each agent run spends some of it, and you never carry the cost of a heavy user who has not paid for it. This post builds the part that has to be right: a ledger where the balance always matches what users bought and spent.</p>

## When credits are the right model

Credits fit when:

- usage per user varies by 10× or more, so any single plan price is wrong for most users;
- usage is occasional (a batch of documents this week, nothing next month) and users resent a subscription;
- you want a [cost-based margin](/blog/price-ai-saas-plan-margins/) on every request without metered invoicing.

A subscription with included credits and paid top-ups combines both: predictable revenue plus a release valve for heavy users. The ledger below supports either, because a monthly grant is just another ledger entry.

## Credits, not dollars, in the UI

Define a credit as a fixed amount of your cost, for example 1 credit = $0.001 of model cost, and price packs with your margin on top: 10,000 credits for $15 means $10 of model cost at most and a 33% gross margin before payment fees. Users see "credits"; you keep the freedom to change models without changing prices. Convert each run's cost to credits from your [usage rows](/blog/meter-claude-api-costs-per-user-nextjs/), which already record the cost in micro-dollars.

## An append-only ledger

Never store the balance as a number you update. Store every change as a row, and compute the balance from the rows:

```sql
CREATE TABLE credit_ledger (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  amount      bigint NOT NULL,          -- + for grants, - for spending
  kind        text NOT NULL,            -- 'purchase', 'grant', 'reserve', 'release', 'spend', 'refund', 'expire'
  ref         text NOT NULL,            -- order id, run id, ...
  expires_at  timestamptz,              -- for purchased and granted credits
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref)
);

CREATE INDEX credit_ledger_user_idx ON credit_ledger (user_id);

CREATE VIEW credit_balances AS
SELECT user_id, sum(amount) AS balance FROM credit_ledger GROUP BY user_id;
```

The `UNIQUE (kind, ref)` constraint is what makes webhooks and retries safe: the same order cannot add credits twice, and the same run cannot be charged twice. It is the same idea as the [webhook event log](/blog/verify-lemon-squeezy-webhooks-nextjs/) and [idempotency keys](/blog/idempotent-agent-requests-double-submit/).

With an append-only ledger, a support question ("where did my credits go?") is a `SELECT` of that user's rows, and your total revenue in credits always reconciles with your orders.

## Adding credits from a Lemon Squeezy order

Create a one-time product per pack in Lemon Squeezy, pass your user id as custom data at checkout, and handle `order_created` in your verified webhook:

```ts
if (event === "order_created" && body.data.attributes.status === "paid") {
  const userId = body.meta.custom_data.user_id;
  const variantId = String(body.data.attributes.first_order_item.variant_id);
  const credits = PACKS[variantId];            // { "123456": 10_000, ... }
  if (!credits) return ok();                   // not a credit pack

  await db.query(
    `INSERT INTO credit_ledger (user_id, amount, kind, ref, expires_at)
     VALUES ($1, $2, 'purchase', $3, now() + interval '12 months')
     ON CONFLICT (kind, ref) DO NOTHING`,
    [userId, credits, `ls_order:${body.data.id}`]
  );
}
```

Map variant ids to credit amounts in your code, never trust an amount from the client, and keep the order id as `ref`. The [license keys post](/blog/license-keys-lemon-squeezy-cloudflare/) shows the same order webhook flow for a downloadable product.

## Spending: reserve, then settle

An agent run's cost is only known at the end, and a user with 50 credits left must not be able to start ten runs in parallel. So spend in two steps, inside one transaction each:

```ts
// 1. Before the run: reserve an estimate
await db.tx(async (t) => {
  await t.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [userId]);
  const { rows } = await t.query(
    `SELECT coalesce(sum(amount), 0) AS balance FROM credit_ledger WHERE user_id = $1`, [userId]
  );
  if (rows[0].balance < estimate) throw new OutOfCredits(rows[0].balance);
  await t.query(
    `INSERT INTO credit_ledger (user_id, amount, kind, ref) VALUES ($1, $2, 'reserve', $3)`,
    [userId, -estimate, runId]
  );
});

// 2. After the run: release the reservation and record the real cost
await db.tx(async (t) => {
  await t.query(
    `INSERT INTO credit_ledger (user_id, amount, kind, ref) VALUES
       ($1, $2, 'release', $3),
       ($1, $4, 'spend',   $3)
     ON CONFLICT (kind, ref) DO NOTHING`,
    [userId, estimate, runId, -actualCredits]
  );
});
```

The advisory lock serializes balance checks for one user, which closes the race where two requests both see enough credits. The [spend limits post](/blog/per-user-spend-limits-in-dollars/) explains that race and the estimate in detail. Inside a run, check the remaining reservation between turns and stop the loop when it runs out, rather than letting one run go far below zero.

If the run crashes before settling, a cleanup job finds `reserve` rows with no matching `release` after your maximum run time and settles them from the usage rows that were recorded.

## Expiry, done honestly

Credits that expire must be spent oldest-first, or users lose credits while holding newer ones. The simplest fair rule: purchased credits are valid for 12 months, and at expiry you write an `expire` row only for what is left of that purchase after spending, computed first-in-first-out. If that feels complex, do not expire purchased credits at all for the first year and decide later; many products only expire free grants. Whatever you choose, write it on the pricing page and in your terms before the first sale.

## Refunds

Lemon Squeezy sends `order_refunded` when you refund an order. Remove the credits that are still unspent from that purchase:

```sql
INSERT INTO credit_ledger (user_id, amount, kind, ref)
SELECT $1, -LEAST($2, (SELECT coalesce(sum(amount),0) FROM credit_ledger WHERE user_id = $1)), 'refund', $3
ON CONFLICT (kind, ref) DO NOTHING;
```

`$2` is the pack's credit amount, `$3` the order ref. Taking the smaller of the pack size and the current balance keeps the balance from going negative when the user already spent part of it. Your refund policy decides whether a partly used pack is refundable at all; the code should follow the policy, not define it.

## What users should see

- The balance, in credits, on every page where they can start a run.
- What a typical action costs ("A document summary uses about 40 credits").
- A history built from the ledger rows: purchases, grants, and spending grouped by day.
- An email when the balance drops below a threshold, sent once per crossing. The [onboarding emails post](/blog/onboarding-emails-ai-saas-resend/) covers usage-triggered messages.

## Summary

- Credits fit products with uneven or occasional usage; a subscription can grant credits too.
- Keep an append-only ledger; compute balances; make `(kind, ref)` unique so webhooks and retries are safe.
- Add credits from a verified `order_created` webhook, with amounts from your own variant map.
- Reserve an estimate under a per-user lock before each run, then release and record the real cost.
- Decide expiry and refund rules up front, publish them, and show users their balance and history.

<!-- site-only -->

*Agentwright Starter includes a Lemon Squeezy webhook handler with an event log and per-user usage metering with price snapshots, two of the pieces a credit ledger builds on. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
