---
title: "The architecture of a Claude agent SaaS, following one request from the browser and back"
description: "An end-to-end map of a production AI agent SaaS built on Next.js, Postgres and the Claude API: authentication, rate limits, spend limits, model choice, the tool loop, streaming, usage metering, storage and billing, in the order a single request meets them, with links to a detailed post for each step."
date: 2026-12-01
slug: claude-agent-saas-architecture-request-path
tags: [architecture, claude, nextjs, saas]
---

<p class="lede">A month ago this blog started with one question: what does it take to charge money for an app built on the Claude API? Since then we have written about each piece separately. This post puts them in order. It follows a single chat message from the moment a user presses Enter until the answer is on screen and the cost is in the database, and links to the detailed post for each step.</p>

The stack is the one we use: Next.js (App Router) on a serverless host, Postgres, the Anthropic TypeScript SDK, and Lemon Squeezy for payments. The ideas carry over to other stacks.

## The whole path on one screen

```text
browser ── POST /api/agent ──▶ 1. who is this?          (session)
                               2. too many requests?     (rate limit)
                               3. any budget left?       (spend limit)
                               4. which model?           (routing)
                               5. the loop ─┬─ Claude API (cached prompt)
                                            ├─ tools (local + MCP)
                                            └─ stop reason?
                               6. stream ◀── SSE events to the browser
                               7. record   ── usage row with price snapshot
                               8. store    ── append-only conversation
webhook ── POST /api/webhooks/lemonsqueezy ─▶ plan + limits
```

Steps 1 to 4 are cheap checks that must all happen **before** the first token is paid for. Steps 5 to 8 happen while and after the model works.

## 1. Who is this?

Every agent request needs a signed-in user, because everything after it (limits, cost, storage) is per user. Email magic links are the simplest sign-in for a developer tool: no passwords to store, and the same email is what the payment provider knows. See [magic-link sign-in with Auth.js and Resend](/blog/magic-link-sign-in-authjs-resend/).

The user ID from the session is the only identity the rest of the request trusts. It is never taken from the request body or from anything the model writes. If you want the database to enforce that too, add [row-level security](/blog/postgres-row-level-security-multi-tenant-agent-saas/).

## 2. Too many requests?

A rate limit protects you from loops, scripts and abuse before they reach the paid API. A fixed-window counter in Postgres is enough at launch scale and needs no extra service: [rate limiting LLM endpoints with Postgres](/blog/rate-limit-llm-endpoints-postgres/).

## 3. Any budget left?

Rate limits count requests; your bill counts tokens. A single request with a long conversation can cost a hundred times more than a short one. So the second check is in dollars: has this user spent their plan's allowance this month? [Per-user spend limits in dollars](/blog/per-user-spend-limits-in-dollars/) shows the check, and [counting tokens before sending](/blog/count-tokens-before-sending-claude/) shows how to reject an oversized request before it costs anything.

## 4. Which model?

Not every route needs the largest model. A title generator, a classifier or a summary can run on a small fast model, and the main agent on a larger one. Choosing per route is often the biggest single cost saving: [choosing a Claude model per route](/blog/choose-claude-model-per-route/).

## 5. The loop

The core of the app is a loop: send the conversation and tool definitions to Claude, and if the answer asks for tools, run them and send the results back, until the model is done. We compared the options in [Claude Agent SDK vs your own tool loop](/blog/claude-agent-sdk-vs-your-own-tool-loop/). Inside the loop:

- **Prompt caching.** The system prompt and tool definitions are the same on every turn; caching them cuts input cost and latency on long conversations: [prompt caching in an agent loop](/blog/prompt-caching-claude-agent-loop/).
- **Tools.** Clear names and descriptions decide whether the model uses a tool well: [writing tool descriptions](/blog/write-tool-descriptions-claude-uses-well/). External tools can come from MCP servers: [MCP servers as tools](/blog/mcp-servers-as-tools-in-your-agent/).
- **Safety.** Tool output is untrusted input: [prompt injection defenses](/blog/prompt-injection-defenses-agent-tools/). Risky actions wait for a person: [approval gates](/blog/approval-gates-for-agent-tool-calls/).
- **Ending correctly.** `stop_reason` tells you why the model stopped, and each value needs different handling: [handling stop reasons](/blog/handle-claude-stop-reasons-agent/). API errors need retries with backoff for the right status codes only: [errors and retries](/blog/claude-api-errors-retries-agent-loop/).
- **Structured results.** When code, not a person, reads the answer, ask for JSON that matches a schema: [structured outputs](/blog/structured-outputs-claude-typescript/).
- **Long conversations.** Eventually a conversation outgrows the context window, or just gets expensive: [compaction and context editing](/blog/long-agent-conversations-compaction-context-editing/).

## 6. Stream it

An agent turn can take tens of seconds. Users accept that if they see progress: text as it is written, and a line for each tool call. Server-sent events from a Next.js route handler do this without WebSockets: [streaming a Claude agent over SSE](/blog/stream-claude-agent-sse-nextjs/). The host must allow a long enough function duration for this route: [deploying on Vercel and Neon](/blog/deploy-nextjs-agent-saas-vercel-neon/). Work that can take minutes belongs in a [background job](/blog/background-agent-jobs-postgres-skip-locked/) instead.

## 7. Record the cost

After each model call, write a usage row: user, model, input, output and cache tokens, and the cost. Store the price that applied at the time, not just the tokens, so a later price change does not rewrite history: [metering costs per user](/blog/meter-claude-api-costs-per-user-nextjs/) and [snapshotting prices per request](/blog/snapshot-llm-prices-per-request/). With those rows, one SQL query shows [your most expensive users](/blog/find-most-expensive-users-sql/).

## 8. Store the conversation

Messages are appended, never edited in place, so you can always rebuild exactly what was sent to the model and debug a bad answer later: [append-only conversation storage](/blog/store-agent-conversations-append-only/).

## And on the side: billing

Payments happen outside the request path. The payment provider calls a webhook when someone subscribes, renews, cancels or gets a refund; the webhook updates the user's plan, and the plan sets the limits that steps 2 and 3 check. Verify every webhook's signature first: [verifying Lemon Squeezy webhooks](/blog/verify-lemon-squeezy-webhooks-nextjs/), then [sync subscriptions to plans](/blog/sync-lemon-squeezy-subscriptions-to-plans/). If you sell a download instead of a subscription, [license keys on Cloudflare](/blog/license-keys-lemon-squeezy-cloudflare/) covers delivery.

How much to charge depends on your cost per user; the [pricing and margins post](/blog/price-ai-saas-plan-margins/) and the free [margin calculator](/tools/ai-saas-margin-calculator/) help with the numbers.

## How you know it works

Two kinds of tests keep this from breaking quietly. Offline tests for tools and the loop run on every commit: [testing an agent without calling Claude](/blog/test-agent-tools-without-calling-claude/). Evals check the model's behaviour against real cases when prompts, tools or models change: [evals for Claude agents](/blog/evals-for-claude-agents-typescript/).

## What we left out on purpose

Vector databases, multi-agent orchestration, fine-tuning and a custom model gateway. All useful in some apps; none needed to launch a paid agent product. Add them when a real user problem asks for them.

<!-- site-only -->

*Agentwright Starter is this architecture as a Next.js codebase: sign-in, rate limits and monthly token caps, the tool loop with MCP, SSE streaming, usage metering with price snapshots, Lemon Squeezy billing, evals and tests. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against the posts and documentation it links to before publishing.*

<!-- /site-only -->
