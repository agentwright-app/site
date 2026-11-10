---
title: "Sell a downloadable product with license keys: Lemon Squeezy webhooks, Cloudflare KV and signed download links"
description: "The license delivery we run for our own product, on Cloudflare Pages Functions with no database: issue a key per order, make it idempotent, sign download links with HMAC, revoke on refund. Web Crypto code included."
date: 2026-11-12
slug: license-keys-lemon-squeezy-cloudflare
tags: [cloudflare, lemonsqueezy, typescript, indiehackers]
---

<p class="lede">If you sell a code template, an ebook or a desktop app, you need three things after the payment: a license key, a download only paying customers can use, and a way to switch both off when someone gets a refund. This post walks through how we do it for our own product, on Cloudflare Pages Functions and Workers KV, in about 200 lines with no database and no extra service.</p>

The payment side is Lemon Squeezy, which acts as merchant of record (it handles sales tax and VAT). The same design works with any provider that sends signed webhooks.

## The flow

1. A customer buys. Lemon Squeezy sends an `order_created` webhook.
2. The webhook function verifies the signature, generates a key and stores a license record.
3. The record includes a signed download link that only works while the license is active.
4. On `order_refunded`, the function marks the license revoked. The same link now returns 403.

Everything runs at the edge, next to the static site. Storage is two key patterns in one KV namespace:

```
license:<key>     → JSON license record
order:<orderId>   → the key issued for that order (makes the webhook idempotent)
```

## Keys people can read over the phone

```ts
/** Keys look like AW-7K3M-Q9XD-2HBN-W4PC (no 0/O/1/I, so nobody has to ask which one it is). */
export function generateLicenseKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  const groups = [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join(""));
  return `AW-${groups.join("-")}`;
}
```

The 32-character alphabet divides 256 evenly, so `b % 32` has no modulo bias. Sixteen characters from 32 symbols is 80 bits of randomness: far too many to guess, short enough to paste. Dropping lookalike characters costs almost nothing in entropy and saves support emails.

## Verify the webhook with Web Crypto

Cloudflare's runtime has the Web Crypto API rather than Node's `crypto` module, so the HMAC check looks a little different from a Node server:

```ts
const enc = new TextEncoder();

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyLemonSqueezySignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  return constantTimeEqual(toHex(await hmac(secret, rawBody)), signature.trim().toLowerCase());
}
```

As with any webhook, sign over the **raw** body: read it with `request.text()` before parsing. We covered the Node.js version, status codes and retries in detail in [Lemon Squeezy webhooks in Next.js](/blog/verify-lemon-squeezy-webhooks-nextjs/).

## The webhook: issue once per order

```ts
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const rawBody = await request.text();
  if (!(await verifyLemonSqueezySignature(rawBody, request.headers.get("x-signature"), env.LEMONSQUEEZY_WEBHOOK_SECRET))) {
    return json(401, { error: "Invalid signature" });
  }
  const payload = JSON.parse(rawBody);
  const event = payload.meta?.event_name;
  const orderId = String(payload.data?.id ?? "");
  const attrs = payload.data?.attributes ?? {};
  const variantId = attrs.first_order_item?.variant_id != null ? String(attrs.first_order_item.variant_id) : null;

  if (event === "order_created") {
    if (variantId !== env.LICENSE_VARIANT_ID) return json(200, { ok: true, result: `ignored: variant ${variantId}` });
    if (await env.LICENSES.get(`order:${orderId}`)) return json(200, { ok: true, result: "already issued" });

    const key = generateLicenseKey();
    const token = await signDownloadToken(key, env.LEMONSQUEEZY_WEBHOOK_SECRET);
    const record = {
      key,
      status: "active",
      orderId,
      email: String(attrs.user_email ?? "").toLowerCase(),
      testMode: Boolean(attrs.test_mode),
      downloadUrl: `${new URL(request.url).origin}/api/download?token=${encodeURIComponent(token)}`,
      emailSent: false,
      createdAt: new Date().toISOString(),
    };
    await env.LICENSES.put(`license:${key}`, JSON.stringify(record));
    await env.LICENSES.put(`order:${orderId}`, key);
    return json(200, { ok: true, result: "license issued" });
  }
  // order_refunded: below
  return json(200, { ok: true, result: `ignored: ${event}` });
};
```

Choices worth explaining:

- **Filter by variant.** One store can sell several products. Only the variant that is sold with a license gets a key; everything else is acknowledged with a 200 so it is not retried.
- **`order:<id>` is the idempotency key.** Lemon Squeezy retries deliveries that fail, so the same order can arrive twice. The second delivery finds the existing key and stops.
- **`testMode` is stored on the record.** Test purchases create real records; marking them means you can list and delete them before launch, and never count them as sales.
- **`emailSent: false`.** Sending the key by email is a separate step that reads this flag and flips it. Keeping it separate means an email outage never makes the webhook fail, and a resend is just running that step again.

**A note on KV consistency.** Workers KV is eventually consistent: a write can take time to become visible in other locations. Two deliveries of the same order processed at the same moment in different data centres could both miss the `order:` key. Lemon Squeezy retries are seconds apart, which makes this rare, and the worst case is a customer with two working keys for one order. If that matters for your product, use a Durable Object or D1 for the order lock.

## Signed download links without a second secret

The download link carries the license key and an HMAC of it:

```ts
function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signDownloadToken(key: string, secret: string) {
  return `${key}.${toBase64Url(await hmac(secret, `download:${key}`))}`;
}

export async function verifyDownloadToken(token: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const key = token.slice(0, dot);
  if (!/^AW(-[A-Z0-9]{4}){4}$/.test(key)) return null;
  const expected = toBase64Url(await hmac(secret, `download:${key}`));
  return constantTimeEqual(expected, token.slice(dot + 1)) ? key : null;
}
```

The `download:` prefix is domain separation: the same secret signs webhooks (by Lemon Squeezy) and download tokens (by us), and the prefix guarantees a signature made for one purpose can never be valid for the other. That lets us reuse the webhook secret instead of managing a second one. If you prefer separate secrets, nothing else changes.

Notice the token does **not** expire. The license status is the expiry: the link works exactly as long as the license is active, which is what a customer who bookmarks it expects. If you want links that also expire, put a timestamp inside the signed message and check it.

## Serving the file

```ts
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const key = await verifyDownloadToken(token, env.LEMONSQUEEZY_WEBHOOK_SECRET);
  if (!key) return text(403, "This download link is not valid.");

  const license = await env.LICENSES.get(`license:${key}`, "json");
  if (!license || license.status !== "active") return text(403, "This license is no longer active.");

  const zip = await env.LICENSES.get("asset:product.zip", "arrayBuffer");
  if (!zip) return text(503, "The download is being prepared. Email us and we'll send it by hand.");

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="product.zip"',
      "cache-control": "private, no-store",
    },
  });
};
```

For a small archive, KV itself is the file store: a value can be up to 25 MiB, so a code template fits with room to spare, and uploading a new release is one `PUT` to the KV REST API. For larger files, keep them in R2 and stream from there; the license check stays identical.

`cache-control: private, no-store` keeps CDNs and shared proxies from caching a paid file, which would otherwise keep serving it after a refund. Every error message tells the customer what to do next; a bare 403 in a browser tab generates a support email anyway, so it might as well contain the address.

## Refunds revoke access

```ts
if (event === "order_refunded") {
  const key = await env.LICENSES.get(`order:${orderId}`);
  const record = key ? await env.LICENSES.get(`license:${key}`, "json") : null;
  if (!record) return json(200, { ok: true, result: "ignored: no license for order" });
  if (record.status !== "revoked") {
    await env.LICENSES.put(`license:${key}`, JSON.stringify({ ...record, status: "revoked", revokedAt: new Date().toISOString() }));
  }
  return json(200, { ok: true, result: "license revoked" });
}
```

Revoking keeps the record instead of deleting it, so you can still answer "was this key ever valid?" and see when it was turned off. The status check runs on every download, so revocation takes effect on the next click, within KV's propagation time.

Be honest with yourself about what revocation can do: a customer who already downloaded the file still has it. Revocation stops future downloads and invalidates the key for anything that checks it (an update server, a CLI that validates keys). For a code template, that is the realistic level of protection, and a fair refund policy matters more than DRM.

## Testing before launch

- Use the provider's test mode and make a real test purchase end to end. Check the record, open the link, refund the test order, open the link again.
- Sign a sample payload yourself with `openssl dgst -sha256 -hmac` to test the 401 path and the variant filter without a checkout.
- Add a `GET` on the webhook path that reports whether the secret and the KV binding are configured (never their values). It turns "is the deploy wired up?" into one request.

<!-- site-only -->

*This is the delivery we run for Agentwright Starter on agentwright.app. The Starter itself has a Postgres version of the same flow (keys, signed downloads, an admin page to resend or revoke) for products you build with it. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed against our production code before publishing.*

<!-- /site-only -->
