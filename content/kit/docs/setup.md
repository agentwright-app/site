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
You can skip this section at first: without it the app runs, and the paid plans on `/pricing`
say "Coming soon".

Billing is [Polar](https://polar.sh), a merchant of record: it charges the customer, handles
sales tax and VAT, and pays you. The short version (every step in full: `docs/polar.md`):

1. In Polar's sandbox (https://sandbox.polar.sh), create one subscription product for each
   paid plan and copy the product ids into `POLAR_PRODUCT_PRO` and `POLAR_PRODUCT_TEAM`.
2. Create an access token with the scopes `checkouts:write` and `customer_sessions:write`
   → `POLAR_ACCESS_TOKEN`. Set `POLAR_SERVER=sandbox` while you test.
3. Add a webhook endpoint `https://<your-domain>/api/webhooks/polar` (format Raw, every
   `subscription.*` event) and put its secret in `POLAR_WEBHOOK_SECRET`. On your own machine,
   `polar webhook listen` or a tunnel brings the events to `localhost`.
4. Sign in, click **Upgrade to Pro** on `/pricing` and pay with the test card.

`BILLING_PROVIDER` picks the provider that the buttons on `/pricing` use:

| `BILLING_PROVIDER` | Buttons on `/pricing` |
| --- | --- |
| empty or not set | Polar |
| `polar` | Polar |
| `lemonsqueezy` | Lemon Squeezy |
| anything else | `/pricing` fails with an error that names the variable, in the browser during `npm run dev` and in the server log in production |

**Lemon Squeezy** accepts no new stores and closes on 2027-03-31. Its adapter is kept only
for apps that already have a Lemon Squeezy store: `docs/lemonsqueezy.md` has the setup and
how to move a live app to Polar.

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
