# Deploy (Vercel + Neon)

The starter is a plain Next.js 15 app with a Postgres database, so it runs anywhere
Next.js runs. This guide covers the zero-ops path: **Vercel** for the app and
**Neon** for Postgres. Both have free tiers that are enough to launch.

## 1. Database — Neon

1. Create a project at https://neon.tech (pick the region closest to your Vercel region).
2. Copy the **pooled** connection string (ends with `-pooler.…neon.tech`). The Drizzle
   client already sets `prepare: false`, which pooled connections require.
3. Run the migrations and seed the plans from your machine:
   ```bash
   DATABASE_URL="postgres://…-pooler…/neondb?sslmode=require" npm run db:migrate
   DATABASE_URL="…" npm run db:seed
   ```
   Re-run `db:migrate` whenever you add a migration (`npm run db:generate` after a schema change).

## 2. App — Vercel

1. Push the repo to GitHub and import it at https://vercel.com/new. Framework preset: Next.js, no changes needed.
2. Add the environment variables (Settings → Environment Variables), for **Production** and **Preview**:

   | Variable | Notes |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | from https://platform.claude.com |
   | `AGENT_MODEL` | optional, default `claude-sonnet-5-5` |
   | `DATABASE_URL` | Neon pooled string |
   | `AUTH_SECRET` | `npx auth secret` |
   | `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth app; callback `https://<domain>/api/auth/callback/github` |
   | `AUTH_TRUST_HOST` | `true` (Auth.js behind Vercel's proxy) |
   | `AUTH_RESEND_KEY` / `AUTH_EMAIL_FROM` | optional magic-link sign-in |
   | `LEMONSQUEEZY_WEBHOOK_SECRET` | from the webhook you create in step 3 |
   | `LEMONSQUEEZY_VARIANT_PRO` | optional, links the Pro plan to a variant |
   | `LEMONSQUEEZY_VARIANT_TEAM` | optional, links the Team plan to a variant |
   | `NEXT_PUBLIC_LS_CHECKOUT_PRO` / `_TEAM` | hosted checkout URLs for /pricing |
   | `MCP_SERVERS` | optional, JSON (HTTP servers only on Vercel — see below) |

3. Deploy. Add your domain under Settings → Domains and update the GitHub OAuth callback URL.

### Function duration
`app/api/agent/route.ts` sets `maxDuration = 300`. The Hobby plan allows up to 300s with
Fluid Compute enabled (default on new projects); on older projects lower it to 60 or enable Fluid Compute.

### MCP on serverless
Stdio MCP servers spawn a child process, which does not work on Vercel functions. Use
HTTP (`{"url": …}`) servers in production, or run the app on a long-lived host
(Railway, Fly.io, a VPS with `npm run build && npm start`) if you need stdio servers.

## 3. Lemon Squeezy webhook

Settings → Webhooks → `+`:
- URL: `https://<domain>/api/webhooks/lemonsqueezy`
- Signing secret: paste the same value into `LEMONSQUEEZY_WEBHOOK_SECRET`
- Events: `order_created`, `order_refunded`, `subscription_*`

Send a test event from the Lemon Squeezy dashboard; it appears in the `webhook_events` table.

## 4. Post-deploy checklist

- [ ] Sign in with GitHub on the production URL
- [ ] Send a message on `/chat` and confirm a row appears in `usage_events` (and on `/usage`)
- [ ] Buy the Pro plan in Lemon Squeezy **test mode** and confirm `users.plan` flips to `pro`
- [ ] Set a spend limit on your Anthropic console workspace

## Other hosts

- **Railway / Fly.io / Render**: `npm run build`, start with `npm start`, same env vars. Stdio MCP servers work here.
- **Cloudflare Workers**: needs `@opennextjs/cloudflare`; `postgres` must be replaced with the Neon serverless driver (`drizzle-orm/neon-http`). Not covered by this starter yet.
- **Docker**: set `output: "standalone"` in `next.config.ts` and copy `.next/standalone` into a `node:22-alpine` image.
