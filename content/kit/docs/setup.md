# Setup

## 1. Postgres
Any Postgres works. Free tiers: [Neon](https://neon.tech), [Supabase](https://supabase.com).
Put the connection string in `DATABASE_URL`, then:
```bash
npm run db:migrate && npm run db:seed
```

## 2. Anthropic
Create an API key at https://platform.claude.com → `ANTHROPIC_API_KEY`.
Default model is `claude-sonnet-5-5`; set `AGENT_MODEL` to change it
(prices live in `lib/billing/pricing.ts` and the `model_prices` table, see `docs/pricing.md`;
switching models: `docs/customizing.md`).

## 3. GitHub OAuth
GitHub → Settings → Developer settings → OAuth Apps → New.
- Homepage URL: `http://localhost:3000`
- Callback URL: `http://localhost:3000/api/auth/callback/github`
Copy Client ID / secret into `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`.
Generate `AUTH_SECRET` with `npx auth secret`.

### Optional: magic-link sign-in (Resend)
Create an API key at https://resend.com/api-keys and verify your sending domain.
Set `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` (e.g. `Agentwright <login@yourdomain.com>`).
The email form on `/login` appears automatically; leave the key empty to keep GitHub-only sign-in.

## 4. Billing
The kit has two billing adapters, Lemon Squeezy and Polar. Both are a merchant of record:
they charge the customer, handle sales tax and VAT, and pay you. `BILLING_PROVIDER` picks the
one the buttons on `/pricing` use: `lemonsqueezy` (the default) or `polar`.

**Polar:** follow `docs/polar.md` and skip the rest of this section.

**Lemon Squeezy:**
1. Create a product + variant for each paid plan; copy the variant ids into `LEMONSQUEEZY_VARIANT_PRO`
   and `LEMONSQUEEZY_VARIANT_TEAM` and re-run `npm run db:seed`.
2. Settings → Webhooks → add `https://<your-domain>/api/webhooks/lemonsqueezy`, set a signing secret
   (`LEMONSQUEEZY_WEBHOOK_SECRET`) and enable `order_*` and `subscription_*` events.
3. Create hosted checkout links (Products → Share) and put them in `NEXT_PUBLIC_LS_CHECKOUT_PRO` /
   `NEXT_PUBLIC_LS_CHECKOUT_TEAM`. `/pricing` appends `checkout[custom][user_id]=<users.id>` so the webhook
   can match the buyer. (Falls back to matching `user_email` against `users.email`.)

Local testing: `npx lmsqueezy@latest` or any tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`).
Webhooks work through a tunnel as they are. To open the app itself through the tunnel in development,
add the tunnel's hostname to `allowedDevOrigins` in `next.config.ts` (see `docs/next16.md`).

## 5. Deploy
Vercel: import the repo, add the env vars, done (`maxDuration` is set to 300s on the agent route; lower it
on the Hobby plan). Full guide (Neon, env vars, webhook, other hosts): `docs/deploy.md`.

## 6. MCP servers (optional)
Set `MCP_SERVERS` to a JSON object of servers (see `lib/agent/mcp.ts`). Each server's tools are registered
as `<server>__<tool>` and become available to the agent on the next request. Use HTTP servers on serverless hosts.

## 7. Evals
`npm run eval -- --model claude-haiku-5-5` runs `evals/cases.ts` through the real agent loop and prints
pass/fail with cost. Add a case whenever you change the system prompt or a tool.

## Next steps
`docs/customizing.md`: add tools, change the system prompt, connect MCP servers, add eval cases,
change plans, caps and rate limits, and switch the model.
