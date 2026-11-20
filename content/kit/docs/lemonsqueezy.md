# Billing with Lemon Squeezy (existing stores only)

> **Lemon Squeezy accepts no new stores and closes on 2027-03-31.** A new app uses Polar,
> the kit's default (`docs/polar.md`). The Lemon Squeezy adapter stays in the kit only so
> that an app that already sells through a Lemon Squeezy store keeps working while it moves
> to Polar: see "Moving a live app to Polar" below.

Since version 0.6.0 Lemon Squeezy is no longer the default. An app that uses it must say so:

```bash
BILLING_PROVIDER=lemonsqueezy
```

Without that line the buttons on `/pricing` are Polar's. The webhook
`POST /api/webhooks/lemonsqueezy` does not depend on the line: it works whenever
`LEMONSQUEEZY_WEBHOOK_SECRET` is set.

The code is `lib/billing/lemonsqueezy.ts` (signature check, what an event does to your
data), `app/api/webhooks/lemonsqueezy/route.ts` and the checkout links in
`lib/billing/checkout.ts`.

## Setup

1. Create a product + variant for each paid plan; copy the variant ids into `LEMONSQUEEZY_VARIANT_PRO`
   and `LEMONSQUEEZY_VARIANT_TEAM` and re-run `npm run db:seed`.
2. Settings → Webhooks → add `https://<your-domain>/api/webhooks/lemonsqueezy`, set a signing secret
   (`LEMONSQUEEZY_WEBHOOK_SECRET`) and enable `order_*` and `subscription_*` events.
3. Create hosted checkout links (Products → Share) and put them in `NEXT_PUBLIC_LS_CHECKOUT_PRO` /
   `NEXT_PUBLIC_LS_CHECKOUT_TEAM`. `/pricing` appends `checkout[custom][user_id]=<users.id>` so the webhook
   can match the buyer. (Falls back to matching `user_email` against `users.email`.)
4. Set `BILLING_PROVIDER=lemonsqueezy`.

Local testing: `npx lmsqueezy@latest` or any tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`).
Webhooks work through a tunnel as they are. To open the app itself through the tunnel in development,
add the tunnel's hostname to `allowedDevOrigins` in `next.config.ts` (see `docs/next16.md`).

A one-time product that issues a license key: `docs/licensing.md`.

## Deploy

Environment variables, next to the ones in `docs/deploy.md`:

| Variable | Notes |
| --- | --- |
| `BILLING_PROVIDER` | `lemonsqueezy` |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | from the webhook below |
| `LEMONSQUEEZY_VARIANT_PRO` | optional, links the Pro plan to a variant |
| `LEMONSQUEEZY_VARIANT_TEAM` | optional, links the Team plan to a variant |
| `NEXT_PUBLIC_LS_CHECKOUT_PRO` / `_TEAM` | hosted checkout URLs for /pricing. Read when the app is built, so deploy again after you change them |

The webhook, in Lemon Squeezy under Settings → Webhooks → `+`:
- URL: `https://<domain>/api/webhooks/lemonsqueezy`
- Signing secret: paste the same value into `LEMONSQUEEZY_WEBHOOK_SECRET`
- Events: `order_created`, `order_refunded`, `subscription_*`

Send a test event from the Lemon Squeezy dashboard; it appears in the `webhook_events` table.

## What each event does

| Event | What the kit does |
| --- | --- |
| `order_created`, `subscription_created`, `subscription_updated`, `subscription_resumed`, `subscription_unpaused`, `subscription_payment_success` | Sets the plan whose `plans.ls_variant_id` is the event's variant. A subscription whose status is not `active`, `on_trial`, `past_due`, `paused` or `cancelled` moves the user to `free` instead. |
| `subscription_cancelled` | Nothing: the plan stays until the paid period ends. |
| `subscription_expired`, `order_refunded` | `free`. |
| `order_created` / `order_refunded` for a variant in `LEMONSQUEEZY_VARIANT_LICENSE` | Issues / revokes a license key (`docs/licensing.md`). |

No Lemon Squeezy event changes the plan of a user whose plan a Polar subscription pays for
(`users.polar_subscription_id` is set).

## Moving a live app to Polar

The kit does not move a subscription from one provider to the other. What it does support is
running both at once: each webhook route works whenever its secret is set, whatever
`BILLING_PROVIDER` says, and `BILLING_PROVIDER` only decides which buttons `/pricing` shows.
So new sales go to Polar while the Lemon Squeezy subscriptions you already have keep
setting plans until they end.

1. **Set up Polar** with `docs/polar.md`, "Setup": products, access token, webhook, first in
   the sandbox and then in production. Leave every `LEMONSQUEEZY_*` variable and the Lemon
   Squeezy webhook as they are.
2. **Switch the buttons.** Change `BILLING_PROVIDER=lemonsqueezy` to `polar` (or remove the
   line) and deploy. From now on **Upgrade** opens a Polar checkout. A user who still pays
   through Lemon Squeezy sees "Current plan" on their plan as before.
3. **Move each subscriber.** A customer has to subscribe again at Polar. Two ways:
   - *When the Lemon Squeezy subscription ends.* Cancel it in Lemon Squeezy. The user keeps
     the plan until the paid period ends; then Lemon Squeezy sends `subscription_expired`,
     the kit moves the user to `free`, and `/pricing` offers **Upgrade** through Polar.
   - *Without a gap.* Send the customer a Polar Checkout Link for the product of their plan
     and ask them to pay with the email address of their account in your app. The Polar
     subscription then gives the plan (`docs/polar.md`, "How an event finds its user"), and
     from that moment no Lemon Squeezy event changes it. Cancel the customer's Lemon Squeezy
     subscription so that they do not pay twice.

   A user should not hold a subscription at both for longer than the move takes: see
   "Two providers at once" in `docs/polar.md`, "Limits".
4. **Check who is left.** These users have a Lemon Squeezy subscription that the kit has
   not seen end. `on_polar` says whether a Polar subscription already gives them the plan:
   ```sql
   select id, email, plan, polar_subscription_id is not null as on_polar
   from users where ls_subscription_id is not null;
   ```
   (A plan bought as a one-time Lemon Squeezy order has no subscription id: those users
   have `ls_customer_id` set and `ls_subscription_id` empty.)
5. **Clean up** when the list is empty: delete the webhook in Lemon Squeezy and remove the
   `LEMONSQUEEZY_*` and `NEXT_PUBLIC_LS_CHECKOUT_*` variables. There is no migration: the
   `ls_*` columns stay in the database and are simply no longer written.

The kit only acts on the events it receives. If a Lemon Squeezy subscription stops without a
`subscription_expired` event reaching your webhook, the user keeps the plan until a Polar
subscription replaces it or you change it yourself:

```sql
update users set plan = 'free', ls_subscription_id = null where id = '<user id>';
```

License keys that were sold through Lemon Squeezy stay valid: a key lives in your `licenses`
table, not at the provider. To sell new keys through Polar, set `POLAR_PRODUCT_LICENSE` and
`POLAR_CHECKOUT_LICENSE` (`docs/licensing.md`).
