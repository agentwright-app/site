---
slug: claude-agent-saas-boilerplate
title: "A Claude agent SaaS boilerplate for Next.js: what it has to cover"
description: "What a Next.js boilerplate for a Claude agent SaaS must cover beyond login and payments: tool loop, per-user token metering, plan caps, MCP and evals."
updated: 2026-11-12
---

<div class="gd-note"><p><strong>Who wrote this.</strong> We make Agentwright Starter, a paid starter kit, and this page describes it. The list of parts is useful whichever kit you choose, and also if you build everything yourself: each part links to a post with the code.</p></div>

<p class="lede">Most Next.js SaaS boilerplates cover sign-in, payments and a landing page. A product where a Claude agent does the work needs more, because every request costs you money and the model decides how many requests there are.</p>

This page lists the parts such a boilerplate has to cover, shows where each one lives in Agentwright Starter, and says plainly what the kit leaves out.

## What a Claude API starter kit for Next.js needs beyond login and payments

| Part | Why it is there | File in the kit | The code, explained |
|---|---|---|---|
| Streaming tool loop | The agent calls Claude, runs the tools it asks for, and repeats. The loop needs a turn limit and has to stream while it works. | `lib/agent/loop.ts`<br>`app/api/agent/route.ts` | [Stream a tool-using Claude agent with SSE](/blog/stream-claude-agent-sse-nextjs/) |
| Token and cost metering per user | You pay per token and your customer pays per month. One row per model call tells you what each user costs. | `lib/billing/metering.ts` | [Meter Claude API costs per user](/blog/meter-claude-api-costs-per-user-nextjs/) |
| Price snapshots | Model prices change. Each usage row keeps the price it was charged with, so past totals stay the same. | `lib/billing/pricing.ts` | [Snapshot prices on every usage row](/blog/snapshot-llm-prices-per-request/) |
| Plan caps and rate limits | A monthly cap checked before each model call, and a requests-per-minute limit that answers 429. | `lib/billing/metering.ts`<br>`lib/ratelimit/index.ts` | [Rate limiting an LLM endpoint with Postgres](/blog/rate-limit-llm-endpoints-postgres/) |
| Prompt caching | The system prompt and the tool list are sent on every turn. Read from the cache, they cost a fraction of the normal input price. | `lib/agent/loop.ts`<br>`lib/agent/system-prompt.ts` | [Prompt caching in an agent loop](/blog/prompt-caching-claude-agent-loop/) |
| Billing webhooks | A subscription changes a user's plan through a signed webhook. | `lib/billing/lemonsqueezy.ts` | [Verify Lemon Squeezy webhooks](/blog/verify-lemon-squeezy-webhooks-nextjs/) |
| MCP servers as tools | Tools that already exist as MCP servers become callable next to your own. | `lib/agent/mcp.ts` | [MCP servers as tools in your own loop](/blog/mcp-servers-as-tools-in-your-agent/) |
| Evals | Golden cases run through the real loop, so a prompt change that breaks behaviour fails CI. | `evals/run.ts`<br>`evals/cases.ts` | [Evals in 140 lines of TypeScript](/blog/evals-for-claude-agents-typescript/) |

[What's inside](/inside/) lists every file of the kit with a one-line note and shows three of them in full: the agent loop, the metering code and the eval cases.

## Claude Agent SDK or your own loop?

If you are looking for a Claude Agent SDK SaaS template, know this first: **Agentwright Starter does not use the Claude Agent SDK.** It calls the Messages API through the Anthropic TypeScript SDK and runs its own loop of about 100 lines.

The Claude Agent SDK is Claude Code packaged as a library. It brings built-in tools for files, shell commands and web search, plus permissions, hooks, subagents and sessions. That makes it a strong start for a coding agent, or for an automation that works on files in a container.

A web app is a different job. Many users send requests to tools that you wrote, and you need to meter and cap every model call. A hand-written loop keeps the prompt small and puts each call in your hands. In our test on November 3, 2026, the same two-request task used 86,630 input tokens through the Agent SDK, nearly all of it the SDK's own prompt and tools (cached), and under 1,000 through a hand-written loop.

The full comparison, with runnable code for both and a decision table, is in [Claude Agent SDK vs rolling your own tool loop](/blog/claude-agent-sdk-vs-your-own-tool-loop/). If your product is a coding agent, start with the Agent SDK and not with this kit.

## What "token billing per user" means in this kit

The phrase can mean two things, and the kit does one of them.

**Metering: yes.** Every model turn writes one row to `usage_events`: input, output, cache read and cache write tokens, the cost in micro-dollars, and the id of the price row that was used. The `/usage` page shows each user their tokens, cost and plan cap. Totals are sums of stored costs, so a price change does not rewrite history. A model without a price row is refused before the API is called, so no call goes unrecorded.

**Charging per token: no.** Plans are flat subscriptions through Lemon Squeezy, and each plan has a monthly token cap. The seeded plans are Free (200,000 tokens a month), Pro (5 million) and Team (25 million). A plan can be allowed to run past its cap, as the seeded Team plan is. That usage is recorded, but the kit does not create a charge for it.

The numbers are yours to change: plans and caps are rows in your database.

## Claude models and prices

The model is a setting (`AGENT_MODEL`, default Claude Sonnet 5.5). The kit ships price rows for these models:

{{models_table}}

Every current price, with the caching and batch rates, is on [Claude API pricing](/pricing/claude/). The [Claude API cost calculator](/tools/claude-api-cost-calculator/) turns them into a cost per request, per user and per month.

## The stack

Next.js 15 with the App Router, TypeScript, the Anthropic TypeScript SDK, the MCP TypeScript SDK, Drizzle ORM on Postgres, Auth.js v5, Tailwind CSS v4 and Zod. Sign-in is GitHub OAuth, with optional email magic links through Resend.

Version {{kit_version}} has {{code_files}} code files with {{code_lines}} lines, {{tests}} tests, and a GitHub Actions workflow that runs the type check, the tests and a production build. The [setup guide](/docs/setup/) and the [deploy guide for Vercel and Neon](/docs/deploy/) that ship with the kit are public.

## Where the kit is weak, and what it does not include

{{weaker_list}}

For kits that cover some of these, see [nine starter kits side by side](/compare/ai-saas-boilerplates/) and the [one-to-one comparisons](/alternatives/).

## Price

{{buy_box}}

## Questions

### Does it use the Claude Agent SDK?

No. It uses the Anthropic TypeScript SDK and its own tool loop. The section above says why, and when the Agent SDK is the better choice.

### Is this an official Anthropic boilerplate?

No. Agentwright is an independent business. The kit is not made, endorsed or sponsored by Anthropic. It is built on Anthropic's public API and SDK.

### Can I use OpenAI or Gemini with it?

No. The loop, the metering and the evals are written for Claude and the Anthropic SDK.

### Does it work with Stripe?

Not out of the box. Lemon Squeezy is the only billing provider in the kit. The provider code sits in a few files, and metering and plan caps read your own database, so they stay the same if you replace it. The [FAQ](/faq/) names the files.

### Which Next.js version does it use?

Next.js 15. The upgrade to 16 is on the roadmap, and the kit includes a note on what changes (`docs/next16.md`).

### Can I see the code before I pay?

Yes. [What's inside](/inside/) lists every file and shows the agent loop, the metering code and the eval cases in full, and the [docs](/docs/) that ship with the kit are public. There is no live demo. If the kit does not fit, the refund window is 14 days.
