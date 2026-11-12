# Selling license keys (one-time purchases)

Besides subscription plans, the starter can sell a **one-time product** of your own
and deliver a license key automatically.

```
Lemon Squeezy checkout ──order_created──▶ /api/webhooks/lemonsqueezy   variant ∈ LEMONSQUEEZY_VARIANT_LICENSE
Polar checkout ─────────order.paid──────▶ /api/webhooks/polar          product ∈ POLAR_PRODUCT_LICENSE
                                               │
                                               ▼
                                      issueLicense()  → licenses table (key AW-XXXX-XXXX-XXXX-XXXX)
                                               ▼
                                      deliverLicense()
                                        ├─ GitHub: invite custom field `github` to LICENSE_GITHUB_REPO (read-only)
                                        └─ Email: key + signed link  /api/download?token=KEY.SIG
                                                                        └─▶ 302 LICENSE_DOWNLOAD_URL
/admin/licenses  ← list, search, resend, revoke, issue by hand
order_refunded (Lemon Squeezy), order.refunded (Polar)  → license revoked, download link stops working
```

## Setup

1. **The product**, at the provider you use:
   - **Lemon Squeezy**: create the product (single payment). Copy its *variant id*
     into `LEMONSQUEEZY_VARIANT_LICENSE` (comma-separate several). Under
     *Checkout → Custom fields* add a text field with key **`github`** labelled
     "GitHub username (for repo access)". Point the webhook at
     `https://your-app/api/webhooks/lemonsqueezy` with `order_created` and `order_refunded`.
     To show a "Buy" card on `/pricing`, put the product's checkout link in
     `NEXT_PUBLIC_LS_CHECKOUT_LICENSE`.
   - **Polar**: create a one-time product and copy its *product id* into
     `POLAR_PRODUCT_LICENSE` (comma-separate several). To ask for the GitHub username,
     create a text field with the slug **`github`** under *Settings → Custom Fields* and
     add it to the product (*Checkout Page → Checkout Fields* in the product form). The
     webhook is `https://your-app/api/webhooks/polar` with `order.paid` and
     `order.refunded` (`docs/polar.md`, "Setup"). To show a "Buy" card on `/pricing`,
     create a Checkout Link for the product and put it in `POLAR_CHECKOUT_LICENSE`.
2. **Email**: set `RESEND_API_KEY` and `EMAIL_FROM` (a verified Resend domain).
   Without a key, emails are printed to the server log and the admin page shows `logged`.
3. **GitHub invite** (optional): `LICENSE_GITHUB_REPO=owner/private-repo` and
   `LICENSE_GITHUB_TOKEN` — a fine-grained token with *Administration: write* on that repo
   (needed to add collaborators). Buyers are added with `pull` permission.
4. **Download** (optional): `LICENSE_DOWNLOAD_URL` — a release zip, R2/S3 object or
   GitHub release asset. Links are signed with `LICENSE_TOKEN_SECRET` (defaults to `AUTH_SECRET`).
5. **Admin**: `ADMIN_EMAILS=you@company.com`, sign in, open `/admin/licenses`.
6. `APP_URL=https://your-app` so emails carry absolute links.

## Behaviour

- One license per order: a replayed webhook returns the existing key.
- Unpaid orders (`status != paid`) are ignored; a refund sets `status = revoked`. With
  Polar, only a refund of the whole order revokes the key, and a partial refund keeps it.
- With Polar, a delivery email that could not be sent makes the webhook answer 500, so
  that Polar sends the event again and the email goes out on a later attempt
  (`docs/polar.md`, "License keys").
- `/api/download` rejects bad signatures (400), unknown keys (404) and revoked keys (403),
  and counts successful downloads.
- `resend` from the admin page repeats the whole delivery (invite + email) and records the outcome.
- Keys use the alphabet `A–Z` without `O`/`I` and digits `2–9`, so they can be read aloud.

## Extending

- Validate keys in your own product: `getLicenseByKey(key)?.status === "active"`.
- Per-seat licenses: add a `seats` column and count activations in a new table.
- Lemon Squeezy also has built-in license keys; this flow keeps the keys in *your*
  database so you can revoke, re-send and gate downloads without another API call.
