---
title: "Lemon Squeezy webhooks in Next.js: verify the signature, log the event, survive retries"
description: "A production-shaped Lemon Squeezy webhook handler for the Next.js App Router: HMAC-SHA256 over the raw body, a timing-safe compare, an event log you can replay, idempotent processing and the status codes that make retries work."
date: 2026-11-05
slug: verify-lemon-squeezy-webhooks-nextjs
tags: [lemonsqueezy, nextjs, billing, typescript]
---

<p class="lede">The webhook handler is the most important 50 lines in a paid SaaS. If it is wrong, people pay and get nothing, or cancel and keep their plan. This post builds one for Lemon Squeezy in the Next.js App Router, step by step, with the failure modes each step prevents.</p>

Everything here is plain TypeScript on Node.js: `node:crypto`, zod for the payload, Drizzle for the two tables. The same structure works for Stripe or Paddle; only the signature scheme changes.

## What Lemon Squeezy sends

When you add a webhook in the Lemon Squeezy dashboard (Settings → Webhooks) you pick the events and set a signing secret. Each delivery is a `POST` with a JSON body and two headers you care about:

- `X-Event-Name`: for example `order_created` or `subscription_updated`. The same value is in the body at `meta.event_name`.
- `X-Signature`: the HMAC-SHA256 of the **raw request body**, keyed with your signing secret, as a hex string.

The body is JSON:API shaped. `data` is the object the event is about (an order, a subscription), `meta` carries the event name and any `custom_data` you attached to the checkout. That last one matters: if you create checkout links with `checkout[custom][user_id]=<your user id>`, the webhook tells you exactly which account paid, and you do not have to match on email.

## Step 1: read the raw body, then verify

The signature is computed over bytes. If you parse the JSON first and re-serialize it, key order and whitespace can change and the signature will never match. In a route handler, read the body once with `req.text()`:

```ts
// app/api/webhooks/lemonsqueezy/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "LEMONSQUEEZY_WEBHOOK_SECRET is not set" }, { status: 500 });

  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get("x-signature"), secret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  // ...parse, log, process (below)
}
```

The check itself:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature.trim(), "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
```

Three details in those lines:

1. **`timingSafeEqual`, not `===`.** A plain string comparison returns early at the first different character, which leaks how much of a forged signature was right. The constant-time compare does not.
2. **The length check comes first.** `timingSafeEqual` throws if the buffers differ in length, and a thrown error in a webhook route is a 500, which tells the sender to retry a request that will never succeed.
3. **`Buffer.from(x, "hex")` drops invalid characters.** A garbage header decodes to a short or empty buffer, so the length check rejects it. The `a.length > 0` guard covers the empty case.

`runtime = "nodejs"` matters because `node:crypto` is not available in the Edge runtime. On the edge you would use `crypto.subtle` with an HMAC key instead; the logic is the same.

## Step 2: validate the shape you depend on

A valid signature tells you who sent the body, not that it has the fields your code reads. Parse only the subset you use, with zod, and let everything else pass through:

```ts
import { z } from "zod";

export const LemonSqueezyWebhook = z.object({
  meta: z.object({
    event_name: z.string(),
    custom_data: z.object({ user_id: z.string().optional() }).passthrough().optional(),
  }),
  data: z.object({
    id: z.string(),
    type: z.string(), // "orders", "subscriptions", ...
    attributes: z
      .object({
        status: z.string().optional(),
        test_mode: z.boolean().optional(),
        user_email: z.string().optional(),
        variant_id: z.coerce.string().optional(),
        first_order_item: z.object({ variant_id: z.coerce.string() }).passthrough().optional(),
      })
      .passthrough(),
  }),
});
```

`z.coerce.string()` on the ids is deliberate: Lemon Squeezy sends numeric ids as numbers in some places and strings in others, and you want one type in your database. Orders carry the variant under `first_order_item.variant_id`; subscriptions have it at `attributes.variant_id`. Reading both saves a confusing afternoon.

If parsing fails, return `400`. The payload will not change on retry, so there is no point asking for one.

## Step 3: log before you process

Insert every verified event into a table before doing anything with it:

```ts
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  eventName: text("event_name").notNull(),
  externalId: text("external_id").notNull(),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

This costs one insert and buys you three things. You can see exactly what arrived when a customer writes "I paid but nothing happened". You can replay an event after fixing a bug, by feeding the stored payload back into the same processing function. And `processedAt IS NULL` gives you a list of events that failed, which is the only monitoring a small product needs on day one.

## Step 4: process, and pick the status code on purpose

```ts
const parsed = LemonSqueezyWebhook.safeParse(JSON.parse(rawBody));
if (!parsed.success) return Response.json({ error: "Unexpected payload" }, { status: 400 });

const [log] = await db
  .insert(webhookEvents)
  .values({ provider: "lemonsqueezy", eventName: parsed.data.meta.event_name, externalId: parsed.data.data.id, payload: parsed.data })
  .returning({ id: webhookEvents.id });

try {
  const outcome = await applyEvent(parsed.data);
  await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, log.id));
  return Response.json({ ok: true, outcome });
} catch (e) {
  await db.update(webhookEvents).set({ error: (e as Error).message }).where(eq(webhookEvents.id, log.id));
  return Response.json({ error: "Processing failed" }, { status: 500 });
}
```

Lemon Squeezy treats any non-2xx response as a failed delivery and retries it with a backoff. That gives you a simple contract:

| Situation | Status | Why |
|---|---|---|
| Bad or missing signature | 401 | Not from Lemon Squeezy; a retry will not fix it |
| Payload does not match the schema | 400 | Same bytes on retry |
| Event you do not handle | 200 | Acknowledge it so it is not retried forever |
| Your database was down | 500 | A retry a few seconds later will probably work |

Returning 200 for unknown events is easy to forget. If you tick more events in the dashboard than your switch statement handles, a 4xx on those would fill the retry queue with noise.

## Step 5: make processing idempotent

Retries mean the same event can arrive twice, and two different events can describe the same change (`subscription_created` and `subscription_updated` often arrive close together). Write each handler so that running it twice leaves the same state:

- **Plan changes are "set", never "add".** `UPDATE users SET plan = 'pro'` is safe to repeat; "add 30 days" is not.
- **One-time grants are keyed by the order id.** If you issue a license key or credits per order, store the Lemon Squeezy order id with a unique index and return the existing row when it is already there.
- **Find the user by `custom_data.user_id` first, then by email.** Email matching breaks when the buyer uses a different address at checkout.

```ts
export async function issueLicense(orderId: string, email: string) {
  const [existing] = await db.select().from(licenses).where(eq(licenses.lsOrderId, orderId));
  if (existing) return { license: existing, created: false };
  const [row] = await db.insert(licenses).values({ key: generateKey(), email, lsOrderId: orderId }).returning();
  return { license: row, created: true };
}
```

A unique index on `ls_order_id` turns the remaining race (two deliveries processed at the same moment) into a constraint error, which becomes a 500 and a retry that then finds the existing row.

## Subscription statuses that trip people up

If you sell subscriptions, map statuses to access explicitly instead of treating everything except `active` as cancelled:

- `cancelled` means the customer cancelled but the period they paid for has not ended. Keep access; Lemon Squeezy sends `subscription_expired` when it does.
- `past_due` means a renewal payment failed and is being retried. Most products keep access during the retry window.
- `expired` and a refunded order are the events that should actually downgrade.

## Testing it locally

You do not need a tunnel to test the handler. Sign a sample body yourself and post it:

```bash
BODY='{"meta":{"event_name":"order_created","custom_data":{"user_id":"u_123"}},"data":{"id":"1","type":"orders","attributes":{"status":"paid","user_email":"a@example.com","first_order_item":{"variant_id":42}}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$LEMONSQUEEZY_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -s localhost:3000/api/webhooks/lemonsqueezy -H "content-type: application/json" -H "x-signature: $SIG" -d "$BODY"
```

Then change one character of the body without re-signing and confirm you get a 401. For end-to-end tests, Lemon Squeezy's test mode sends real webhooks for test purchases, with `test_mode: true` on the order or subscription attributes, so you can run the full checkout flow before you go live.

## Checklist

- Raw body with `req.text()`, signature verified before parsing.
- Constant-time comparison with a length check.
- zod schema for the fields you read, `400` when it fails.
- Every verified event logged, with `processedAt` and `error`.
- `200` for events you ignore, `500` only for failures a retry can fix.
- Handlers that are safe to run twice, keyed by order or subscription id.

<!-- site-only -->

*This is the webhook handler that ships in Agentwright Starter, a Next.js starter kit for Claude-powered SaaS with auth, Lemon Squeezy or Polar billing, metering and an agent loop already wired together. Launch price $99; the [FAQ](/faq/) has the details.*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed against the code before publishing.*

<!-- /site-only -->
