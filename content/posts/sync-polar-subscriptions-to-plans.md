---
title: "Keep your app's plans in sync with Polar subscriptions (statuses, out-of-order webhooks, plan changes)"
description: "A verified webhook is only half of billing. How to store a Polar subscription so your app always knows who has access: one row per subscription, newest event wins by Polar's own timestamp, a status-to-access table, plan changes through the API or the customer portal, and a nightly reconcile job."
date: 2026-11-21
slug: sync-polar-subscriptions-to-plans
tags: [polar, billing, saas, postgres]
---

<p class="lede">Receiving a billing webhook safely is the first half of the job: verify the signature, log the event, survive retries. This post is about the second half, which is where most billing bugs actually live: after the webhook arrives, what does your app store, and how does it decide whether this user can use the paid features right now?</p>

The examples use [Polar](https://polar.sh), a merchant of record. Lemon Squeezy, which many SaaS starters were built on, accepts no new stores and closes on 2027-03-31, so new projects need another provider. The pattern is the same for any provider that sends the whole subscription with each event. The Polar fields and API behaviour below were checked against the Polar API reference on 2026-11-17.

## The mistake: a `plan` column driven by event names

The first version of most integrations looks like this: `subscription.created` sets `users.plan = 'pro'`, `subscription.revoked` sets it back to `'free'`. It works in testing and then fails in three ways in production:

1. **Events can arrive out of order.** Polar delivers every event at least once and does not promise the order. A retry of an older `subscription.updated` can land after a newer one. If each event writes the plan, the older event wins.
2. **The event name does not tell you the state.** When a customer cancels, Polar sends `subscription.canceled` while the subscription's status is still `active`, because the customer has paid until the end of the period. A handler that reads "canceled" in the name and removes the plan takes away something the customer paid for.
3. **You lose the facts you need later.** Support asks "which subscription gives this customer the Pro plan?" and the only thing stored is the word `pro`.

The fix is to store the subscription itself, as Polar describes it, and derive access from it.

## One row per subscription

```sql
CREATE TABLE polar_subscriptions (
  id          text PRIMARY KEY,            -- Polar subscription id
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  customer_id text,
  product_id  text NOT NULL,
  status      text NOT NULL,               -- trialing, active, past_due, paused, canceled, unpaid, incomplete_expired
  event_at    timestamp NOT NULL,          -- when Polar created the last event applied to this row (UTC)
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX ON polar_subscriptions (user_id);
CREATE INDEX ON polar_subscriptions (customer_id);
```

Every `subscription.*` webhook carries the full subscription object in `data`. So the handler does not need to know what changed. It writes the product and the status as they are now, and it treats all the subscription events the same way. `user_id` can be empty: someone can pay through a checkout link before they have an account in your app.

## The newest event wins, by Polar's clock

Each webhook payload has a `timestamp`, the moment Polar created the event. Store it with the row, and only let an event change the row if it is at least as new as the one already applied:

```ts
await db.execute(sql`
  INSERT INTO polar_subscriptions (id, user_id, customer_id, product_id, status, event_at)
  VALUES (${sub.id}, ${userId}, ${sub.customer_id}, ${sub.product_id}, ${sub.status},
          (${eventTime}::timestamptz at time zone 'UTC'))
  ON CONFLICT (id) DO UPDATE SET
    user_id     = coalesce(polar_subscriptions.user_id, EXCLUDED.user_id),
    customer_id = coalesce(EXCLUDED.customer_id, polar_subscriptions.customer_id),
    product_id  = EXCLUDED.product_id,
    status      = EXCLUDED.status,
    event_at    = EXCLUDED.event_at
  WHERE polar_subscriptions.event_at <= EXCLUDED.event_at
`);
```

The `WHERE` on the `DO UPDATE` is the whole trick. A stale event becomes a no-op, and because the write is a single statement that locks the row, two deliveries racing each other cannot interleave.

Two details are easy to miss:

- **Keep the microseconds.** Two events of one subscription can be less than a millisecond apart. A JavaScript `Date` rounds to milliseconds and would make them equal. Pass the timestamp to Postgres as text, as above, and let Postgres parse it.
- **Do not overwrite the user.** `coalesce(polar_subscriptions.user_id, …)` keeps a subscription with the user it was first matched to, also when the customer later changes their email at Polar.

## Status decides access, not event names

Polar has eight subscription statuses. Decide once, in one place, what each means for your product:

| Status | Meaning | Paid access? |
|---|---|---|
| `trialing` | In a free trial | Yes |
| `active` | Paid. Also the status of a subscription the customer has cancelled, until the paid period ends | Yes |
| `past_due` | A renewal payment failed; Polar retries it over about three weeks | Your choice (see below) |
| `paused` | Payment collection is paused | No, until it resumes |
| `canceled` | Ended | No |
| `unpaid` | Payment recovery failed | No |
| `incomplete_expired` | The first payment never completed | No |
| `incomplete` | A checkout that is not paid yet | Ignore the event |

```ts
const ACCESS_STATUSES = new Set(["active", "trialing"]);
const RECORDED_STATUSES = new Set(["past_due", "paused", "canceled", "unpaid", "incomplete_expired"]);

if (!ACCESS_STATUSES.has(sub.status) && !RECORDED_STATUSES.has(sub.status)) {
  return `ignored: status ${sub.status}`; // incomplete, and any status Polar adds later
}
```

Three decisions are in that code:

- **A cancelled subscription keeps access without any date arithmetic.** It stays `active` until the period ends and only then becomes `canceled`, so the status alone is enough.
- **`past_due` is a product decision.** Keeping access during the retries is friendlier. But if every request costs you money, as it does in an AI product, three weeks of unpaid use is expensive. Our kit removes the plan at once, shows the user that the payment failed, and gives the plan back when a retry succeeds. Adding `past_due` to `ACCESS_STATUSES` reverses that.
- **An unknown status changes nothing.** A status that Polar adds in the future is neither recorded nor allowed to take a plan away.

A user's plan is then the plan of their best subscription with an access status, or `free`. Work it out from the stored rows in the same transaction as the upsert, every time, also when the event turned out to be stale. Then redelivering any event from Polar's dashboard repairs a plan that is wrong for any reason.

Map products to plans in configuration, not in code, and decide what happens when a paying customer's product is missing from the map. The safe answer is to leave the plan alone and log it: a missing mapping is almost always your own configuration slip, and a paying customer must not lose access over it.

## Which user is this?

A subscription event has to find its user. Use the strongest evidence first:

1. `metadata.user_id`, which you set when your app creates the checkout for a signed-in user. Polar copies checkout metadata to the subscription.
2. `customer.external_id`, your own id for the customer, which Polar stores on a customer that such a checkout creates.
3. Another subscription of the same Polar customer that already belongs to exactly one user.
4. The customer's email, compared with your users' emails without regard to case, and only if exactly one user matches.

If nothing matches, store the row without a user and log it. When that person signs up, the next event of the subscription (or a redelivery) links them.

## Plan changes

There are two ways to move a customer from Pro to Team.

**The customer portal.** Polar's portal lets customers change plan, update the card, see invoices and cancel. What they may do there is set under Settings → Customer Portal. Your app creates a portal session for the customer and redirects to it. This is the least code, and it is what our kit does.

**The API.** `PATCH /v1/subscriptions/{id}` with the new `product_id`:

```ts
await fetch(`https://api.polar.sh/v1/subscriptions/${subscriptionId}`, {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`,
  },
  body: JSON.stringify({ product_id: teamProductId, proration_behavior: "invoice" }),
});
```

`proration_behavior` is optional and accepts `invoice`, `prorate`, `next_period` or `reset`. Without it, Polar uses your organization's default setting. Try each value you plan to use in the sandbox and read the resulting invoice before you rely on it. The same endpoint cancels a subscription at the end of the period with `cancel_at_period_end: true`, and undoes that with `false`.

Either way, do not change the plan in your database when the API call returns. Wait for the `subscription.updated` webhook and let the upsert apply it. That keeps one code path for every change, whether it came from your app, the portal or the Polar dashboard.

One more Polar rule shapes the UI: by default a customer can hold one subscription. A user who already has one should see "Change plan" (the portal or the API call), not a second checkout, which Polar would refuse.

## Reconcile every night

Webhooks are reliable, but your endpoint is not always up, a deploy can drop a request, and Polar stops retrying a delivery after a limited number of attempts. A small nightly job removes the whole class of "the webhook never arrived" problems:

1. Note the time, then list subscriptions from the API (`GET /v1/subscriptions/`, 100 per page at most, with `page` and `limit`).
2. For each one, run the same upsert, with the time you noted as the event time. An event that Polar created after the job started is newer and still wins.
3. Log how many rows changed. Zero is the normal result; anything else is worth a look, because it means a webhook was missed.

Because the reconcile and the webhook share one function, there is nothing extra to keep in sync.

## Test the cases that break

Polar has a sandbox with its own API host (`sandbox-api.polar.sh`) and test cards. Run through these before launch and check the stored row after each:

- Subscribe, then cancel: the status stays `active`, and access stays on until the period ends.
- Change plan in the portal: the new `product_id` appears after the webhook, not before.
- Redeliver an older event from the endpoint's delivery list: the row must not change.
- Deliver the same event twice at the same moment: one row, one plan change.
- Pay through a checkout link with an email that has no account yet, then sign up: the subscription is linked on its next event.
- Delete a row and run the reconcile job: the row comes back.

## Summary

- Store the subscription, one row per subscription, and derive the plan from the rows.
- Upsert with `WHERE stored.event_at <= incoming.event_at`, using Polar's event timestamp with its microseconds, so out-of-order events cannot win.
- Decide access from the status, never from the event name. A cancelled subscription is `active` until its period ends.
- Choose on purpose what `past_due` means, and let unknown statuses change nothing.
- Match the user by your own id in the checkout metadata first, and by email last.
- Change plans through the portal or `PATCH product_id`, and let the webhook update your data.
- Reconcile nightly with the same upsert.

<!-- site-only -->

*Agentwright Starter ships this for Polar: the `polar_subscriptions` table, event-time ordering, the status rules and the user matching above, with the customer portal for plan changes. The [Polar guide](/docs/polar/) describes it. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against the Polar API reference and the kit's own code before publishing.*

<!-- /site-only -->
