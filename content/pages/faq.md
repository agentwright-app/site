## Price and payment

### How much does Agentwright Starter cost?

The list price is **$149**, paid once. At launch the first 50 licenses cost **$99**: the code **LAUNCH** is applied for you at checkout. After those 50 are gone, the price is $149.

### Is it a subscription?

No. You pay once and keep the code. There is no monthly fee and no update plan to renew.

### When can I buy it?

The Starter (version 0.4.1) is finished and checkout is opening shortly. [Leave your email](/#waitlist) and we will send you one email with the checkout link the moment it is live.

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

You can't resell or republish the Starter's source as a starter kit, template or library, paid or free, and you can't put it in a public repository. The app you build is yours; the restriction only covers passing on the Starter itself. Details are in the [license terms](/legal/).

## What you get

### What is inside the Starter?

One Next.js codebase (currently version 0.4.1) with these parts already wired together:

- **Agent loop:** a streaming route with tool calls, max-turn guards and prompt caching, plus a chat UI.
- **MCP tools:** connect any MCP server (stdio or HTTP) with one config entry; its tools become callable by the agent.
- **Per-user metering:** every Claude call is recorded with tokens, cost and the exact price version used, checked against plan caps, and shown on a `/usage` dashboard. Prices are versioned, so past totals stay the same when model prices change.
- **Billing:** Lemon Squeezy checkout links and webhooks for your own plans.
- **Auth:** GitHub sign-in, plus optional email magic links through Resend.
- **Rate limiting:** per-plan requests per minute, with proper `429` responses.
- **Evals:** a small runner with golden test cases and a cost report per case.
- **License delivery:** if you sell a digital product yourself, the code to issue license keys, signed download links and an admin page.
- **Docs:** setup, a Vercel + Neon deploy guide, and a changelog.

### What is the tech stack?

Next.js 15 (App Router), TypeScript, the official Anthropic TypeScript SDK, the MCP TypeScript SDK, Drizzle ORM with Postgres, Auth.js, Tailwind CSS and Zod. It runs on Node.js and deploys to Vercel or any host that runs Next.js.

### Which Claude models does it support?

Any model on the Claude API. The default is Claude Sonnet 5.5, and the metering price table ships with Claude Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 (including the Haiku long-context price). Switching models is one environment variable.

### What do I need to run it?

An Anthropic API key, a Postgres database (the free tiers of Neon or Supabase work) and a GitHub OAuth app for sign-in. A Lemon Squeezy account is only needed when you start charging your own users. Your API and hosting costs are your own.

### How is it delivered?

Right after checkout you get a license key and a download link for the source as a zip file. Unzip it, run `npm install`, add your keys to `.env` and run `npm run dev`.

### Do I get access to a GitHub repository?

No. Delivery is the zip download and your license key. You put the code in your own private repository.

## Updates and support

### Do I get updates?

Yes, for the life of the product, at no extra cost. When models, SDKs or billing APIs change, we update the Starter and publish a new version for license holders. The changelog that ships with the code lists every change.

### How do I get support?

By email at [hello@agentwright.app](mailto:hello@agentwright.app). We answer setup and bug questions about the Starter. We check the inbox every day.

### Is support or the code written with AI?

Yes, partly. Agentwright is built and run with heavy help from Claude, and every change is tested before release. Replies marked Agentwright in our blog comments are AI-assisted and checked against the post.

### Something here is unclear. Where do I ask?

Email [hello@agentwright.app](mailto:hello@agentwright.app), or leave a comment under any [blog post](/blog/). We read both every day.
