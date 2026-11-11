---
title: "Deploy a Next.js AI agent SaaS on Vercel and Neon: the settings that matter for streaming agents"
description: "A launch checklist for a Next.js + Postgres agent app on Vercel and Neon: pooled vs direct connection strings, where to run migrations, function duration for long agent turns, regions, preview deployments with their own database branch, OAuth callbacks and webhooks that don't reach previews."
date: 2026-11-23
slug: deploy-nextjs-agent-saas-vercel-neon
tags: [nextjs, vercel, postgres, deployment]
---

<p class="lede">A Next.js app with a Postgres database deploys to Vercel and Neon in about ten minutes, and both have free tiers that are enough to launch. An app whose main feature is a streaming AI agent has a few extra requirements that the ten-minute guides skip: requests that run for minutes, many short database connections from serverless functions, and webhooks and OAuth callbacks that need stable URLs. This is the checklist we use.</p>

Plan limits and dashboard names below were checked on 2026-11-05. Vercel and Neon change their plans from time to time, so confirm the numbers on their pricing and limits pages before you rely on them.

## The shape of the deployment

- **Vercel** runs the Next.js app. Each API route becomes a serverless function.
- **Neon** runs Postgres. It can scale to zero when idle, and it can create a copy-on-write **branch** of your database in about a second.
- **The Claude API** is called from the agent route and streamed back to the browser over SSE.

## 1. Use the pooled connection string in the app

Serverless functions start and stop all the time, and each instance opens its own connections. Postgres has a fixed connection limit, so connect through Neon's connection pooler. In the Neon console's **Connect** dialog, the pooled string has `-pooler` in the host name.

The pooler runs PgBouncer in transaction mode, which does not support prepared statements across transactions. With `postgres.js`, turn them off:

```ts
// lib/db/client.ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const client = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
export const db = drizzle(client);
```

`max: 1` keeps each function instance to one connection; the pooler multiplexes them.

## 2. Run migrations outside the build, with the direct string

Do not run migrations inside `next build`. Builds run for preview branches too, and a half-finished migration during a build is hard to recover from. Run them as a separate step, before you promote the deploy:

```bash
DATABASE_URL="$DIRECT_DATABASE_URL" npm run db:migrate
```

Use the **direct** (non-pooled) connection string for migrations. Schema changes and the locks migration tools take are the kind of session-level work a transaction-mode pooler is not designed for. A GitHub Action that runs on pushes to `main` is enough: migrate, then let Vercel deploy. Write migrations that are additive (add the column, deploy the code, drop the old column later), because for a short time the old code runs against the new schema.

## 3. Give the agent route enough time

An agent turn with several tool calls can run well past a minute. Set the function duration on the route, and make it dynamic so nothing is cached:

```ts
// app/api/agent/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconds
```

At the time of writing, with Fluid compute (on by default), Vercel allows 300 seconds on the Hobby plan and 800 seconds on Pro. Older projects without Fluid compute can have a lower limit, so check **Settings → Functions**. If a request hits the limit, the stream stops mid-answer, so design for it: save the conversation after every turn (an [append-only log](/blog/store-agent-conversations-append-only/) makes that cheap), and move tasks that need many minutes to a [background job](/blog/background-agent-jobs-postgres-skip-locked/) that the browser polls.

Streaming itself needs no special setting on the Node.js runtime: return a `Response` with a `ReadableStream` and `Content-Type: text/event-stream`, as in the [SSE post](/blog/stream-claude-agent-sse-nextjs/). Do not wrap the agent route in middleware that reads the response body. While a long tool call runs and no tokens flow, send an SSE comment line (`: ping`) every 15 seconds or so; some proxies and HTTP/1.1 clients close connections that stay silent too long.

## 4. Put the functions next to the database

Each agent turn makes several database queries: load the conversation, check the rate limit and the spend limit, record usage, save the messages. At 70 ms round trip between regions, that adds up to a noticeably slower first token. Choose the Neon region first, then set the same area under the Vercel project's **Settings → Functions → Function Region**. The Claude API call matters less here; it is one request per turn.

On Neon's free plan the database scales to zero after a few minutes of inactivity, and the first query after that waits while it wakes up. That is fine for a new product. When you have paying users, either accept it or turn scale-to-zero off on a paid plan.

## 5. Give preview deployments their own database

Every pull request gets a Vercel preview deployment. If previews use the production `DATABASE_URL`, a migration in a pull request changes the production schema, and testers write junk into real tables. Neon branches solve this: a branch is a full copy of the database that shares storage with its parent until it diverges. Neon's Vercel integration can create a branch for each preview deployment automatically; follow its setup guide to wire the branch's connection string into the preview's environment. If you do not use the integration, at least create one long-lived `preview` branch and set its URL for the **Preview** environment in Vercel.

## 6. Environment variables, per environment

In **Settings → Environment Variables**, each variable can be set for Production, Preview and Development separately. The ones that should differ:

| Variable | Production | Preview |
|---|---|---|
| `DATABASE_URL` | production branch, pooled | preview branch, pooled |
| `ANTHROPIC_API_KEY` | production key | a separate key with a low spend limit |
| `LEMONSQUEEZY_*` | live mode | test mode |
| `AUTH_SECRET` | its own value | its own value |

A separate Anthropic key for previews means a runaway test loop cannot spend production money, and the usage page shows the two apart. Set a monthly spend limit in the Anthropic Console for both.

## 7. OAuth and webhooks need stable URLs

Preview URLs change with every deploy, which breaks two things:

- **OAuth callbacks.** A GitHub OAuth app accepts one callback URL. Register one app for production (`https://yourdomain.com/api/auth/callback/github`) and, if you need sign-in on previews, a second app pointed at a fixed preview domain that you assign to the preview branch. Magic-link sign-in works on any URL, which makes it handy for previews. Set `AUTH_TRUST_HOST=true` so Auth.js accepts the host Vercel forwards.
- **Webhooks.** Point Lemon Squeezy's live webhook at the production domain only. Vercel's deployment protection puts previews behind a login, so a webhook sent to a preview URL is rejected anyway. To test webhooks, use test mode with a tunnel to your machine, or a stable preview domain with protection bypass configured.

## 8. Things that do not work on serverless

- **Stdio MCP servers.** They spawn a child process per server, which is not a good fit for short-lived functions. Use MCP servers over HTTP in production, or run the app on a long-lived host (Railway, Fly.io, a VPS) if you need stdio servers.
- **In-memory state.** A cache, a rate-limit counter or a WebSocket held in memory exists only in one function instance. Keep shared state in Postgres.
- **Writing files.** The filesystem is read-only except `/tmp`, and `/tmp` disappears with the instance.

## The post-deploy check

Run this once on the production URL before you announce anything:

- [ ] Sign in (GitHub and magic link).
- [ ] Send a chat message and watch it stream; a row appears in your usage table.
- [ ] Ask the agent something that needs several tool calls; the stream completes.
- [ ] Buy the paid plan in Lemon Squeezy test mode; the plan changes after the webhook.
- [ ] Open a pull request; its preview uses the preview database, not production.
- [ ] Spend limits are set on both Anthropic keys.

## Summary

- Pooled connection string in the app (`prepare: false`, one connection per instance); direct string for migrations, run outside the build.
- `maxDuration`, `dynamic = "force-dynamic"` and the Node.js runtime on the agent route; save after every turn and move long tasks to background jobs.
- Same region for functions and database.
- A separate database branch and a separate, limited API key for previews.
- Production-only OAuth callback and webhook URLs; magic links for previews.

<!-- site-only -->

*Agentwright Starter includes a Vercel + Neon deployment guide with an environment variable table, a 300-second agent route and a post-deploy checklist. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against the Vercel and Neon documentation before publishing.*

<!-- /site-only -->
