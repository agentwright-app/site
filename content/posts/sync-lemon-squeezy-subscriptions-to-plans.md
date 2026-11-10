---
title: "Keep your app's plans in sync with Lemon Squeezy subscriptions (statuses, plan changes, out-of-order webhooks)"
description: "A verified webhook is only half of billing. How to store a Lemon Squeezy subscription so your app always knows who has access: one row per subscription, last-write-wins on updated_at, a status-to-access table, plan changes with proration, the customer portal link, and a nightly reconcile job."
date: 2026-11-21
slug: sync-lemon-squeezy-subscriptions-to-plans
tags: [lemonsqueezy, billing, saas, postgres]
---

<p class="lede">An earlier post covered receiving a Lemon Squeezy webhook safely: verify the signature, log the event, survive retries. This post is about the next question, which is where most billing bugs actually live: after the webhook arrives, what does your app store, and how does it decide whether this user can use the paid features right now?</p>

The subscription fields and API behaviour below were checked against the Lemon Squeezy API reference on 2026-11-05. The companion post on [verifying Lemon Squeezy webhooks](/blog/verify-lemon-squeezy-webhooks-nextjs/) covers signatures, logging and status codes.

## The mistake: a `plan` column driven by event names

The first version of most integrations looks like this: `subscription_created` sets `users.plan = 'pro'`, `subscription_expired` sets it back to `'free'`. It works in testing and then fails in three ways in production:

1. **Events can arrive out of order.** A retry of an older `subscription_updated` can land after a newer one. If each event writes the plan, the older event wins.
2. **Many events mean "something changed".** Plan changes, payment method updates, pauses and renewals all produce `subscription_updated`. A handler keyed on event names misses some of them.
3. **You lose the facts you need later.** Support asks "when does this customer's access end?" and the only thing stored is the word `pro`.

The fix is to store the subscription itself, as Lemon Squeezy describes it, and derive access from it.

## One row per subscription

```sql
CREATE TABLE subscriptions (
  ls_subscription_id text PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id),
  variant_id         text NOT NULL,
  status             text NOT NULL,        -- on_trial, active, paused, past_due, unpaid, cancelled, expired
  renews_at          timestamptz,
  ends_at            timestamptz,          -- set for cancelled and expired
  trial_ends_at      timestamptz,
  customer_portal_url text,                -- pre-signed, valid for 24 hours
  ls_updated_at      timestamptz NOT NULL, -- data.attributes.updated_at from Lemon Squeezy
  synced_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON subscriptions (user_id);
```

Every subscription webhook carries the full subscription object in `data.attributes`. So the handler does not need to know what changed. It writes the object as it is now, which makes `subscription_updated` (sent on any change) the only event you strictly need. The other `subscription_*` events are useful for emails and analytics, but the stored state comes from the object.

## Last write wins, by Lemon Squeezy's clock

To survive out-of-order delivery, compare the object's own `updated_at` with the one you stored, and only write if the incoming one is newer:

```ts
export async function upsertSubscription(userId: string, sub: { id: string; attributes: LsSubscription }) {
  const a = sub.attributes;
  await db.execute(sql`
    INSERT INTO subscriptions (ls_subscription_id, user_id, variant_id, status, renews_at, ends_at,
                               trial_ends_at, customer_portal_url, ls_updated_at)
    VALUES (${sub.id}, ${userId}, ${String(a.variant_id)}, ${a.status}, ${a.renews_at}, ${a.ends_at},
            ${a.trial_ends_at}, ${a.urls?.customer_portal ?? null}, ${a.updated_at})
    ON CONFLICT (ls_subscription_id) DO UPDATE SET
      variant_id = EXCLUDED.variant_id, status = EXCLUDED.status,
      renews_at = EXCLUDED.renews_at, ends_at = EXCLUDED.ends_at,
      trial_ends_at = EXCLUDED.trial_ends_at,
      customer_portal_url = EXCLUDED.customer_portal_url,
      ls_updated_at = EXCLUDED.ls_updated_at, synced_at = now()
    WHERE subscriptions.ls_updated_at <= EXCLUDED.ls_updated_at
  `);
}
```

The `WHERE` on the `DO UPDATE` is the whole trick. A stale event becomes a no-op, and because the write is a single statement, two deliveries racing each other cannot interleave. Use `<=` rather than `<` so that a redelivery of the same event still refreshes the portal URL.

## Status decides access, not event names

Lemon Squeezy has seven statuses. Decide once, in one function, what each means for your product:

| Status | Meaning | Paid access? |
|---|---|---|
| `on_trial` | In a free trial (`trial_ends_at` is set) | Yes |
| `active` | Paid and renewing | Yes |
| `past_due` | A renewal payment failed; Lemon Squeezy is retrying | Yes, with a banner asking to update the card |
| `unpaid` | Payment recovery failed after the retries | No (your dunning settings decide whether it later expires) |
| `paused` | Payment collection is paused | Your choice; most products say no |
| `cancelled` | Cancelled, but the paid period has not ended (`ends_at` is set) | Yes, until `ends_at` |
| `expired` | Ended | No |

```ts
export function hasPaidAccess(s: Subscription, now = new Date()): boolean {
  switch (s.status) {
    case "on_trial":
    case "active":
    case "past_due":
      return true;
    case "cancelled":
      return s.ends_at !== null && s.ends_at > now;
    default:
      return false; // unpaid, paused, expired, and anything new
  }
}
```

Two details matter here. `cancelled` checks `ends_at` itself instead of waiting for `subscription_expired`, so access ends on time even if that webhook is delayed. And the `default` branch denies access, so a status added in the future fails closed. (Whether `paused` keeps access is a product decision; write it down either way.)

A user's plan is then the variant of their best subscription that passes `hasPaidAccess`, or `free`. Compute it on read, or keep a cached `users.plan` that you recompute in the same transaction as the upsert. Do not maintain it as a separate source of truth.

## Plan changes and proration

To move a customer from Pro to Team, send a `PATCH /v1/subscriptions/:id` with the new `variant_id`:

```ts
await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${subId}`, {
  method: "PATCH",
  headers: {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
  },
  body: JSON.stringify({
    data: { type: "subscriptions", id: subId, attributes: { variant_id: teamVariantId, invoice_immediately: true } },
  }),
});
```

The proration options:

- **Default:** the change is prorated on the next invoice; a downgrade becomes a credit.
- **`invoice_immediately: true`:** charge the prorated difference now. Good for upgrades, because the customer gets the higher limits and you get paid at the same moment.
- **`disable_prorations: true`:** no proration; the new price applies from the next renewal. It overrides `invoice_immediately`. Good for downgrades if you prefer simple invoices.

Do not change the plan in your database when the API call returns. Wait for the `subscription_updated` webhook and let the upsert apply it. That keeps one code path for every change, whether it came from your app, the customer portal or the Lemon Squeezy dashboard. Subscriptions paid with PayPal cannot be changed through this endpoint; send those customers to the portal.

## Let the customer portal do the rest

Each subscription object includes `urls.customer_portal`, a pre-signed link where the customer can change their card, see invoices and cancel or resume. It is valid for 24 hours, so do not email it or cache it for long. Store the latest one from the webhook, and when the user clicks "Manage billing", fetch the subscription from the API if `synced_at` is older than a few hours:

```ts
const res = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${subId}`, { headers });
const { data } = await res.json();
redirect(data.attributes.urls.customer_portal);
```

A "cancel" button in your own UI is optional. If you build one, `PATCH` with `cancelled: true`; the customer can resume with `cancelled: false` until `ends_at`.

## Reconcile every night

Webhooks are reliable, but your endpoint is not always up, a deploy can drop a request, and a bug can mark an event as processed without applying it. A small nightly job removes the whole class of "the webhook never arrived" problems:

1. List subscriptions from the API (`GET /v1/subscriptions?filter[store_id]=…`, paginated).
2. For each one, call the same `upsertSubscription`. The `updated_at` guard makes this safe to run at any time.
3. Log how many rows changed. Zero is the normal result; anything else is worth a look, because it means a webhook was missed.

Because the reconcile and the webhook share one function, there is nothing extra to keep in sync.

## Test the cases that break

In Lemon Squeezy test mode, run through these before launch and check the stored row after each:

- Subscribe, then cancel: status `cancelled`, `ends_at` set, access still on.
- Upgrade with `invoice_immediately`: new `variant_id` after the webhook, not before.
- Replay an older event from your event log: the row must not change.
- Use a test card that fails on renewal to reach `past_due`, then recover it.
- Delete a row and run the reconcile job: the row comes back.

## Summary

- Store the subscription object, one row per subscription, and derive access from it.
- Upsert with `WHERE stored.updated_at <= incoming.updated_at` so out-of-order events cannot win.
- Map all seven statuses in one function whose default is "no access"; check `ends_at` for `cancelled`.
- Change plans with `PATCH variant_id`, choose the proration mode on purpose, and let the webhook update your data.
- Use the pre-signed customer portal link for card changes and invoices, and refresh it before redirecting.
- Reconcile nightly with the same upsert.

<!-- site-only -->

*Agentwright Starter ships a verified Lemon Squeezy webhook with an event log, maps variants to plans and keeps access for cancelled subscriptions until the period ends. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against the Lemon Squeezy API reference before publishing.*

<!-- /site-only -->
