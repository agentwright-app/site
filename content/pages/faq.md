## Price and payment

### How much does Agentwright Starter cost?

The list price is **$149**, paid once. At launch the first 50 licenses cost **$99**: the code **LAUNCH** is applied for you at checkout. After those 50 are gone, the price is $149.

### Is it a subscription?

No. You pay once and keep the code. There is no monthly fee and no update plan to renew.

### When can I buy it?

Now. The Starter (version 0.5.1) is on sale: use the [Buy now button](/#pricing). The launch price of $99 is applied automatically for the first 50 licenses. Your license key and download link are emailed to you right after payment.

### Who handles the payment?

[Polar](https://polar.sh) is our merchant of record. They take the payment, charge the right sales tax or VAT for your country, and send the invoice. You can pay by card or the other methods Polar shows at checkout.

### Can I get an invoice for my company?

Yes. Polar emails a receipt with every order. At checkout you can mark the purchase as a business purchase and add your company name and tax ID so they appear on the invoice.

## Refunds and license

### What is the refund policy?

**14 days, no questions asked.** Email [hello@agentwright.app](mailto:hello@agentwright.app) within 14 days of purchase with your order number and you get a full refund to your original payment method. The license key and download link stop working after the refund. Full terms are on the [refund policy and license page](/legal/).

### What does one license cover?

One person, or one team working for the same company or client. You can build and ship as many products as you like with it, including commercial SaaS you sell to your own customers.

### What can't I do with the code?

You can't resell or republish the Starter's source as a starter kit, template or library, paid or free, and you can't put it in a public repository. That includes a starter kit, template or boilerplate built from the Starter's code. The app you build is yours; the restriction only covers passing on the Starter itself. Details are in the [license terms](/legal/).

## What you get

### Can I read the code before I buy?

Yes. [What's inside](/inside/) lists every file in the kit with a one-line note and shows three files in full: the agent loop, the metering code and the eval cases. The [docs](/docs/) that ship with the kit (setup, deploy, model prices and license delivery) are on this site, and so is the [changelog](/changelog/).

### What is inside the Starter?

One Next.js codebase (currently version 0.5.1) with these parts already wired together:

- **Agent loop:** a streaming (SSE) route with parallel tool calls, a 12-turn guard and prompt caching on the system prompt and tools, plus a minimal chat UI.
- **MCP tools:** connect stdio or Streamable HTTP MCP servers with one entry each in `MCP_SERVERS`; their tools become callable by the agent.
- **Per-user metering:** every Claude call is recorded with tokens, cost and the exact price version used, checked against the plan's monthly token cap, and shown on a `/usage` dashboard. Prices are versioned, so past totals stay the same when model prices change.
- **Billing:** Lemon Squeezy or Polar, chosen with one setting: checkout from the pricing page and subscription webhooks that set each user's plan. With Polar, the pricing page also opens the customer's billing portal.
- **Auth:** GitHub sign-in, plus optional email magic links through Resend.
- **Rate limiting:** per-plan requests per minute, with proper `429` responses.
- **Evals:** a small runner with golden test cases and a cost report per case.
- **License delivery:** if you sell a digital product yourself, the code to issue license keys, signed download links and an admin page.
- **Tests and CI:** unit tests, Postgres integration tests, and a GitHub Actions workflow that runs the type check, the tests and a production build.
- **Docs:** setup, customizing, a Vercel + Neon deploy guide, model prices, license delivery, a roadmap and a changelog.

### What is not included?

No Stripe or Paddle integration (billing is Lemon Squeezy or Polar). No teams, organizations or seats: each user has one plan. No other model providers, only Claude. No charging for overage: a plan can be allowed to go past its cap, but nothing bills for it. Caps are monthly token counts, not dollar limits. No job queue, no RAG or search, no file uploads, no MCP server of its own (it connects to MCP servers as a client), and the chat UI shows plain text, without Markdown rendering.

### What is the tech stack?

Next.js 16 (App Router), TypeScript, the official Anthropic TypeScript SDK, the MCP TypeScript SDK, Drizzle ORM with Postgres, Auth.js v5, Tailwind CSS v4 and Zod. It runs on Node.js.

### Where can I deploy it?

The deploy guide walks through Vercel with Neon step by step, and has short notes for Railway, Fly.io, Render and Docker. Cloudflare Workers is not covered yet. The app needs Node.js, a Postgres database, and a function timeout of up to 300 seconds for the agent route (`maxDuration = 300`; on Vercel's Hobby plan that needs Fluid Compute, or you lower it). Stdio MCP servers need a long-running server, not serverless functions.

### Which Claude models does it support?

The default is Claude Sonnet 5.5. The metering price table ships with Claude Fable 5.2, Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 (including the Haiku long-context price). You switch models with the `AGENT_MODEL` environment variable. For any other Claude model, add a row to `BUILTIN_PRICES` in `lib/billing/pricing.ts` and run `npm run db:seed`. A model without a price row is refused before the API is called, so no request goes unmetered.

### What do I need to run it?

An Anthropic API key, a Postgres database and a GitHub OAuth app for sign-in. The setup docs name the free tiers of Neon and Supabase, and the deploy guide uses Neon. The code needs no provider-specific Postgres features, so any Postgres should work, but we have not tested each provider (CI runs on Postgres 16). A Lemon Squeezy or Polar account is only needed when you start charging your own users. Your API and hosting costs are your own.

### Can I use Polar, Stripe or Paddle instead of Lemon Squeezy?

Polar: yes, since version 0.5.0. Set `BILLING_PROVIDER=polar` and follow the [Polar guide](/docs/polar/). The pricing page then creates a Polar checkout for the signed-in user, the webhook keeps each user's plan in step with their subscription, and customers manage their subscription in Polar's portal. The adapter is new: it has automated tests with real and sample Polar webhook payloads, and on 2026-11-13 we ran a subscription through it in Polar's sandbox (Polar's real servers, a test card, no real money) from checkout to plan change and cancellation. The guide lists the same five steps to check with your own Polar account before you take payments.

Stripe and Paddle: yes, but you do that part yourself. The provider-specific code sits in a few files: a webhook route (`app/api/webhooks/polar/route.ts`), the event handling and API calls in `lib/billing/`, and the mapping from products to plans. Metering, plan caps and the rest of the app read your own database, not the provider, so they stay the same. Adding a provider means writing those billing files for its checkout and webhooks; the two that ship are the examples to follow.

### How is it delivered?

Right after payment you get an email from hello@agentwright.app with your license key and a signed download link for the source as a zip file. There is no activation and no phone-home. To set it up: unzip it, copy `.env.example` to `.env.local` and fill in your keys, then run `npm install`, `npm run db:migrate`, `npm run db:seed` and `npm run dev`.

### Do I get access to a GitHub repository?

No. Delivery is the zip download and your license key. You put the code in your own private repository.

## Updates and support

### Do I get updates?

Yes, for the life of the product, at no extra cost: every future version is included. If we ever stop maintaining it, we will say so on this site, and you keep every version you downloaded. The [changelog](/changelog/) lists every release.

### How do I get support?

By email at [hello@agentwright.app](mailto:hello@agentwright.app). We answer setup and bug questions about the Starter, usually within one business day.

### Who makes this?

Agentwright is a small independent business with one product. Most of the code and docs are written with Claude, the way the kit expects you to work. Every release passes a type check, unit tests, a Postgres integration test and a production build in CI, and every change is in the [changelog](/changelog/).

### Is support or the code written with AI?

Yes, mostly. Agentwright is built and run with heavy help from Claude. Every release goes through CI (type check, unit and database tests, production build) first. Replies marked Agentwright in our blog comments are AI-assisted and checked against the post.

### Something here is unclear. Where do I ask?

Email [hello@agentwright.app](mailto:hello@agentwright.app), or leave a comment under any [blog post](/blog/).
