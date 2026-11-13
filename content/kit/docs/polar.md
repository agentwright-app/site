# Billing with Polar

The kit has two billing adapters: Lemon Squeezy (the default) and [Polar](https://polar.sh).
Both are a merchant of record: they charge the customer, handle sales tax and VAT, and pay
you. This page covers Polar: setup, what each webhook does to your data, how to test it,
and the limits you should know before you take money with it.

With `BILLING_PROVIDER=polar`:

- **Upgrade** on `/pricing` creates a Polar checkout for the signed-in user and sends them
  to it.
- **Change plan** and **Manage billing** open Polar's customer portal, where the customer
  changes plan, updates the card, cancels and downloads invoices.
- **`POST /api/webhooks/polar`** keeps `users.plan` in step with the customer's
  subscription, and issues license keys for a one-time product (`docs/licensing.md`).

The code is `lib/billing/polar.ts` (configuration, signature check, API calls),
`lib/billing/polar-events.ts` (what an event does to your data),
`app/api/webhooks/polar/route.ts` and `app/pricing/actions.ts`. The kit calls Polar's API
with `fetch`. It does not use Polar's SDK.

## Setup

Do all of this in Polar's **sandbox** first (https://sandbox.polar.sh). The sandbox is a
separate server with its own account, organization, products and tokens. Nothing you
create there exists in production, so you repeat steps 1 to 3 in production when you go
live.

1. **Products.** Create one subscription product for each paid plan. A Polar product has one
   billing interval, so a plan with monthly and yearly billing is two products. Copy the
   product ids (Products → the menu button next to a product → Copy Product ID) into `POLAR_PRODUCT_PRO` and
   `POLAR_PRODUCT_TEAM`, comma-separated when a plan has several:
   ```bash
   POLAR_PRODUCT_PRO=<monthly product id>,<yearly product id>
   POLAR_PRODUCT_TEAM=<product id>
   ```
   The first id is the one selected when the checkout opens. The name of the variable is
   `POLAR_PRODUCT_` plus the plan's id in upper case, so a plan `max` in your `plans` table
   uses `POLAR_PRODUCT_MAX`. The mapping is read from the environment on every request:
   there is nothing to seed.
2. **Access token.** Settings → Access Tokens → Create token, with the scopes
   `checkouts:write` and `customer_sessions:write`. Put it in `POLAR_ACCESS_TOKEN`. If you
   give the token an expiry date, checkout stops working on that date until you replace it.
3. **Webhook.** Settings → Webhooks → Add Endpoint:
   - URL: `https://<your-domain>/api/webhooks/polar`
   - Format: **Raw**
   - Secret: generate one and put the same value in `POLAR_WEBHOOK_SECRET`
   - Events: every `subscription.*` event, plus `order.paid` and `order.refunded` if you
     sell license keys
4. **Environment.**
   ```bash
   BILLING_PROVIDER=polar
   POLAR_SERVER=sandbox        # remove this line (or set production) when you go live
   ```
   Optional: `POLAR_PORTAL_URL=https://polar.sh/<your-slug>/portal` (in the sandbox:
   `https://sandbox.polar.sh/<your-slug>/portal`), see "Customer portal" below.
5. Run `npm run db:migrate`. Migration `0003_polar` adds the `polar_subscriptions` table
   and a few columns.

A paid plan shows "Coming soon" on `/pricing` until `POLAR_ACCESS_TOKEN` and that plan's
`POLAR_PRODUCT_*` variable are set.

### Testing on your machine

Polar has to reach your webhook, so `localhost` needs one of these:

- **Polar's CLI** (`npm install -g @polar-sh/cli`): `polar webhook listen 3000/api/webhooks/polar`
  forwards your organization's events to the local server. `polar webhook listen --print-secret`
  prints the secret to put in `POLAR_WEBHOOK_SECRET` while you use it.
  `polar webhook trigger subscription.active` sends a sample event.
- **A tunnel** (for example `cloudflared tunnel --url http://localhost:3000`): use the
  tunnel's address in the webhook endpoint.

Only Polar needs the tunnel. Keep opening the app at `http://localhost:3000` in your
browser, so that the buttons and the return address after checkout work as they are.

In the sandbox, pay with the test card `4242 4242 4242 4242`, any future date and any CVC.

### Check it before you go live

We ran these five steps with version 0.5.0 in Polar's sandbox (see "What is tested"). Your
account, products and environment variables are your own, so walk through them once in the
sandbox yourself, and look at `users.plan` after each step:

| Step | Expected |
| --- | --- |
| Sign in, click **Upgrade to Pro**, pay with the test card | `plan` is `pro` within a few seconds. `/pricing` shows "Current plan" on Pro and a **Manage billing** button. |
| **Manage billing** | Polar's customer portal opens, signed in as that customer. |
| In the portal, change to the other plan | `plan` follows. |
| In the portal, cancel the subscription | `plan` stays: access runs until the paid period ends. |
| In Polar's dashboard, open the subscription and revoke it | `plan` is `free`. |

Every delivery is in the `webhook_events` table with what the handler did:

```sql
select created_at, event_name, outcome, error from webhook_events
where provider = 'polar' order by created_at desc limit 20;
```

## What each event does

| Event | What the kit does |
| --- | --- |
| `subscription.*` (any of them) | Stores the subscription's product and status in `polar_subscriptions`, then works out the user's plan from that user's subscriptions. |
| `order.paid` for a product in `POLAR_PRODUCT_LICENSE` | Issues a license key and delivers it (`docs/licensing.md`). |
| `order.refunded` for a product in `POLAR_PRODUCT_LICENSE` | Revokes the key on a full refund. A partial refund keeps it. |
| anything else | Answered with 200 and ignored. |

The kit looks at the **status** inside the event, not at the event's name:

| Subscription status | Plan |
| --- | --- |
| `active`, `trialing` | The plan of the product (`POLAR_PRODUCT_<PLAN>`). |
| `past_due` (a renewal payment failed, Polar is retrying) | `free`. The plan comes back when a retry succeeds. See "Failed payments". |
| `paused` | `free` until the subscription resumes. |
| `canceled`, `unpaid`, `incomplete_expired` | `free`. |
| `incomplete`, or a status the kit does not know | Ignored. |

A customer who cancels keeps the plan until the end of the period they paid for: Polar
sends `subscription.canceled` with status `active`, and the status changes to `canceled`
when the period ends.

Three rules protect your users from mistakes:

- **Polar only takes away a plan that Polar gave.** `users.polar_subscription_id` says
  which Polar subscription gives the user the plan. When it is empty (a plan you set by
  hand, or one Lemon Squeezy pays for), no Polar event can move the user to `free`. A Polar
  subscription that starts for such a user does replace that plan, and the earlier plan
  does not come back when the subscription ends.
- **A product that is not in `POLAR_PRODUCT_*` never takes a plan away.** If a paying
  customer's subscription moves to a product you did not map, the plan stays as it is and
  the outcome in `webhook_events` says which variable to set.
- **Late and repeated deliveries do no harm.** Polar delivers every event at least once
  and does not promise the order. Each row in `polar_subscriptions` keeps the time of the
  last event applied to it, to the microsecond, and an older event never changes the stored
  status or product. Every delivery, old or new, works the plan out again from the stored
  rows, so redelivering an event from Polar's dashboard is always safe.

### How an event finds its user

1. `metadata.user_id`: the checkout that `/pricing` creates puts the signed-in user's id
   there, and Polar copies it to the subscription.
2. `customer.external_id`: Polar stores the same id on a customer that this checkout
   creates.
3. Another subscription of the same Polar customer that already belongs to one user.
4. The customer's email, compared with `users.email` without regard to case.

Steps 3 and 4 exist for subscriptions that did not start on `/pricing`, for example one
bought through a Checkout Link on your landing page. Once a subscription is matched it
stays with that user, also when the customer changes their email at Polar.

If no user matches, the subscription is stored without one and the outcome says
`ignored: no matching user`. This happens when someone pays before they have an account.
After they sign up with the same email, redeliver any event of that subscription from the
endpoint's delivery list in Polar (Settings → Webhooks), or wait for the subscription's
next event.

## Customer portal

**Manage billing** asks Polar for a portal session for the customer whose external id is
the signed-in user's id. The button appears once the user has had a subscription.

Polar sets that external id only on a customer that the kit's checkout created. When the
buyer's email already belonged to a Polar customer (they bought something from you before),
Polar attaches the purchase to that customer and does not set the id. The kit then cannot
open a one-click session, and it does not try by customer id: a buyer can check out with
someone else's email address, and a session opened by customer id would then show that
person's invoices. Instead the button sends the user to `POLAR_PORTAL_URL`, your portal's own
sign-in page, where Polar emails a code to the customer. Set that variable, or the user
sees "The billing portal could not be opened".

What customers can do in the portal (change plan, pause, change email) is set in Polar
under Settings → Customer Portal.

Polar allows one subscription per customer unless you turn on "Allow multiple
subscriptions". That is why a user who has a subscription sees **Change plan** (the portal)
instead of **Upgrade** (a second checkout, which Polar would refuse). If one user does end
up with two paid subscriptions, the plan with the larger `monthly_token_cap` applies.

## Failed payments

When a renewal payment fails, the subscription becomes `past_due` and Polar retries after
2, 7, 14 and 21 days. The kit moves the user to `free` at once and back to the plan when a
retry succeeds. `/pricing` then tells the user that the last payment did not go through.
An AI app pays for every request, so the kit does not give three weeks of unpaid use by
default.

To keep the plan during the retries, add `"past_due"` to `POLAR_ACCESS_STATUSES` in
`lib/billing/polar.ts`. Polar's setting "Grace period for benefit revocation" does not do
this: it applies to Polar's own benefits, and the kit follows the subscription's status.

## License keys

`POLAR_PRODUCT_LICENSE` lists the one-time products that issue a license key, and
`POLAR_CHECKOUT_LICENSE` is the Checkout Link shown on `/pricing`. The flow, the email and
the admin page are the same as with Lemon Squeezy and are described in `docs/licensing.md`.
Two things are specific to Polar:

- If the license email cannot be sent, the webhook answers 500. Polar then delivers the
  event again (up to ten attempts in all, within about an hour), and the next attempt sends
  the email for the key that is already stored. A buyer never gets two keys or two emails,
  also when Polar delivers one event twice at the same moment: the delivery that finds the
  other one still sending answers 500, and Polar's next attempt finds the email sent.
  If every attempt fails, the license is on `/admin/licenses` with delivery `failed`: fix
  the email settings and click **Resend**.
- If a refund arrives before `order.paid` could be processed, the order is recorded as
  revoked, so the late `order.paid` does not send a key.

## API versions

Polar versions its API by date and removes a version about nine months after it first
appears. A new version becomes current in the first week of January, April, July and
October.

- **Webhooks.** Your endpoint has its own version (set when you create it). The kit reads a
  small set of fields that exist in 2026-04, 2026-10 and 2027-01, and ignores the rest, so
  it does not depend on which of these your endpoint uses.
- **API calls.** The two calls the kit makes send `Polar-Version: 2026-10`. Polar is
  expected to remove that version in the first week of April 2027. When Polar answers that
  the version is gone, the kit logs a warning (`[polar] Polar no longer serves API version
  …`) and repeats the call without the header, which means "the current version". Checkout
  keeps working as long as the current version still accepts the same request.
  `POLAR_API_VERSION` sets another version.

Because of this, check the changelog of the kit once a quarter, or search your server log
for `[polar]`.

## Limits

- **Refunding a subscription payment does not end the subscription.** Polar keeps it
  active, and so does the kit. To end access, cancel or revoke the subscription in Polar.
- **Plans are subscriptions.** A one-time Polar product can issue a license key but cannot
  give a plan. (The Lemon Squeezy adapter does accept a one-time variant for a plan.)
- **Seats and metered prices** are not handled. A subscription gives its plan to one user.
- **Deleting a user** does not cancel their subscription at Polar.
- **Two providers at once.** Both webhooks work whenever their secrets are set, so you can
  move from Lemon Squeezy to Polar while old subscriptions keep running. While a Polar
  subscription gives a user the plan, Polar decides it, and no Lemon Squeezy event changes
  it. A user should not hold a subscription at both, because the kit does not remember the
  Lemon Squeezy plan under the Polar one: when the Polar subscription ends, the user is on
  `free` until the next Lemon Squeezy event (a renewal, for example) sets the plan again.
- **Ten billing requests a minute for each user.** Upgrade, Change plan and Manage billing
  each call Polar's API with your token. A user who goes over the limit sees "could not be
  opened" until the minute has passed (`BILLING_ACTIONS_PER_MINUTE` in
  `app/pricing/actions.ts`).

## What is tested

`npm test` covers the signature check, the payload schemas, the API client (against a
stand-in for Polar's API) and, with `TEST_DATABASE_URL`, every flow on this page against a
real Postgres: purchase, cancel, revoke, failed payment, plan change, late and repeated
deliveries, deliveries at the same moment, user matching, licenses and refunds.

The payloads in `tests/fixtures/polar/` are two real deliveries from a live Polar store (a
one-time order and its refund) and sample events generated by Polar's server for every
subscription event. The signature check was compared, on 20,000 generated requests, with
the one that has verified real Polar deliveries on agentwright.app since 2026-11-10, and
the two agreed on every request.

On 2026-11-13 version 0.5.0 was also run against Polar's sandbox: Polar's real servers, the
test card, no real money. The app was a production build that received Polar's own signed
deliveries through `polar webhook listen`. A subscription was bought with **Upgrade**
(once as a new customer and once as a returning one), moved from one plan to the other in
the customer portal opened by **Manage billing**, canceled in the portal and then revoked.
`users.plan` was as the table in "Check it before you go live" says after every step, and
the events of the purchase arrived out of order, as Polar says they can.

What has not been done: a payment with real money through this adapter, and a live run of
a renewal or a failed renewal, which come a month after the purchase. Those two are covered
by the automated tests with Polar's sample events.

## Troubleshooting

- **The webhook answers 403.** The body says why. `no-matching-signature`:
  `POLAR_WEBHOOK_SECRET` is not the secret of this endpoint (sandbox and production
  endpoints have different secrets). `timestamp-out-of-tolerance`: the delivery is more
  than five minutes old or your server's clock is wrong. `missing-headers`: the request did
  not come from Polar.
- **The user paid but the plan did not change.** Look at `outcome` in `webhook_events`.
  `ignored: product … is not mapped to a plan`: add the product id to `POLAR_PRODUCT_<PLAN>`,
  restart the app, and redeliver any event of that subscription from Polar.
  `ignored: no matching user`: see "How an event finds its user". No row at all: the webhook
  did not arrive, so check the endpoint's deliveries in Polar.
- **"The checkout could not be opened."** The server log has the reason on a line that
  starts with `[polar]`. A 401 means the token is wrong, expired, or belongs to the other
  server (a sandbox token needs `POLAR_SERVER=sandbox`). A 403 means the token lacks a scope.
- **Polar disabled the endpoint.** Polar does this after ten failed deliveries in a row,
  and emails the organization's members. Fix the cause, enable the endpoint again in
  Settings → Webhooks and redeliver the failed events from the endpoint's delivery list.
