# Changelog

All notable changes to Agentwright Starter. Format: [Keep a Changelog](https://keepachangelog.com), versions follow SemVer.

## [Unreleased]

## [0.4.2] — 2026-11-11

### Added
- **Claude Fable 5.2 prices** (`claude-fable-5-2@2026-11-11`: $8 / $40 per MTok, cache read $0.20, cache write $10), checked on the official pricing page on 2026-11-11. Before this, `AGENT_MODEL=claude-fable-5-2` failed with `MISSING_PRICE`. Existing installs: run `npm run db:seed`, which inserts missing price rows and leaves existing ones unchanged. The Fable 5.1 row stays.
- `docs/customizing.md`: adding a tool, changing the system prompt (and what that does to the prompt cache), MCP servers, eval cases, plans, caps and rate limits, switching the model. Linked from the README and `docs/setup.md`.
- `docs/ROADMAP.md`: what is planned and what is not in this kit.
- `AGENTS.md` (and a `CLAUDE.md` that imports it): commands and the rules a coding agent should follow in this codebase.
- Tests: Fable 5.2 price row; `assertWithinCap` with a missing plan row or user; parallel requests against the rate limiter (DB test).

### Changed
- **The license text now matches the terms published on the site** (LICENSE version 1.1): one license covers one person or one team (the same company, or the same client), every future version is included at no extra cost, and there is a 14-day refund with no reason needed. It also adds that the license key and download link must not be shared outside your team, that a client can receive the source of the app built for them, and that a refund or termination ends updates and support. The restriction on building a competing product is gone; the license only restricts passing on the Starter's source. This applies to existing licenses too. The README was updated to match.
- The default system prompt starts with "You are the assistant inside this app." and ends with a new line that asks for plain text without Markdown, because the chat UI shows text as written. The other lines are unchanged.
- `.env.example`: removed `LEMONSQUEEZY_API_KEY` and `LEMONSQUEEZY_STORE_ID`, which no code reads, and an example checkout link.
- `docs/next16.md`: decision line reworded; the upgrade is listed in the roadmap.
- `/pricing`: the one-time license card is generic: it shows `LICENSE_PRODUCT_NAME` (default "License") instead of selling this kit. The Pro and Team cards list their requests per minute instead of "Priority models" and "Shared workspace", which the kit does not have.
- License delivery email: the product name defaults to "your license", the link is labelled "Download", and the getting-started line is replaced by the optional `LICENSE_EMAIL_FOOTER`. `.env.example` sets `LICENSE_PRODUCT_NAME="My Product"`.
- Migration `0001_week3_ratelimit_licenses` is renamed `0001_ratelimit_licenses`. Its SQL and journal timestamp are unchanged, and Drizzle tracks applied migrations by hash and timestamp, not by name, so existing databases are not affected.
- `.env.example`: added `AUTH_TRUST_HOST` (needed in production behind a proxy).

### Fixed
- `assertWithinCap` threw a `TypeError` when the user or the user's plan row was missing. It now throws an error with code `NO_USER` or `NO_PLAN`; the `NO_PLAN` message says to run `npm run db:seed`. The agent route logs these errors on the server and sends the browser a generic message with the code. The cap itself works as before; its comment now says what it counts: input + output tokens of the current UTC month, no cache tokens, checked before each model turn, so one turn can go past the cap.
- **Rate limit could be exceeded by parallel requests.** `checkRateLimit` counted and inserted without a lock, so parallel requests from one user could all read the same count and all pass (12 of 12 with a limit of 5 in the new test). The count and insert now run in one transaction under a Postgres advisory lock per user and bucket. No migration needed.
- A comment in `lib/billing/lemonsqueezy.ts` pointed to `docs/billing.md`, which does not exist; it now points to `docs/setup.md`, section 4.
- Removed `docs/TODO.md` (internal build notes).
- `db:migrate`, `db:seed` and `eval` now read `.env.local` like the app does (and `.env` as a fallback). Before this, the quick start's `.env.local` was not read by these scripts.
- **Empty values in the env file switched off the defaults.** `.env.example` ships `AGENT_MODEL=`, `LICENSE_TOKEN_SECRET=`, `APP_URL=` and `RESEND_API_KEY=` empty, and the code fell back to its default only when a variable was missing, not when it was empty. With the example file copied as is, every chat request failed with `MISSING_PRICE`, license delivery failed with "Set LICENSE_TOKEN_SECRET (or AUTH_SECRET)", delivery emails had links without a host, and an empty `RESEND_API_KEY=` hid a configured `AUTH_RESEND_KEY`. An empty value now falls back like a missing one.
- **A Team purchase did not change the user's plan.** Only the Pro plan could be linked to a Lemon Squeezy variant, so the webhook ignored Team orders. `npm run db:seed` now links the Team plan to `LEMONSQUEEZY_VARIANT_TEAM` (new in `.env.example`, `docs/setup.md` and `docs/deploy.md`). An empty variant value is now stored as `NULL`.

## [0.4.1] — 2026-11-05

### Fixed
- **Agent requests failed with a 400 once MCP servers added three or more tools.** Every tool definition carried its own `cache_control` marker, and the API allows at most 4 cache breakpoints per request ("A maximum of 4 blocks with cache_control may be provided"). Tools no longer carry markers; the system-prompt breakpoint already caches tools + system, because tools render first. Regression test in `tests/tools.test.ts`.

## [0.4.0] — 2026-11-04

### Added
- **Price snapshots on every usage row.** New `model_prices` table (versioned rates in integer micro-USD per MTok, `effective_from`, `source`, long-context tier via `min_prompt_tokens`) and `usage_events.price_id`. `recordUsage` picks the price in effect at request time, stores the cost and the price id, so historical totals never change when prices do and every charge can be explained. Price changes are new rows; rows dated in the future take effect on their date. See `docs/pricing.md`.
- `/usage` shows "Prices used this month" (price version, rates, calls, cost) and the price id on each recent call.
- Claude Fable 5.1 prices ($10 / $50 per MTok, cache read $0.25, cache write $12.50) and the Haiku 5.5 long-context price for prompts over 100,000 tokens ($0.50 / $2.50).
- `npm test`: unit tests for price selection and cost math, plus a Postgres integration test (`TEST_DATABASE_URL`). GitHub Actions runs typecheck, tests (with a Postgres service) and `next build` on pull requests.
- `runAgent` checks that the model has a price before calling the API (`MISSING_PRICE`), so no request is made that could not be metered.
- `npm run db:seed` inserts missing price rows from `lib/billing/pricing.ts` and warns when an existing row differs.
- Migration `0002_price_snapshots` (creates and seeds `model_prices`, adds nullable `usage_events.price_id`; rows recorded before 0.4.0 keep `NULL`).
- `lib/billing/checkout.ts`: `license` checkout (`NEXT_PUBLIC_LS_CHECKOUT_LICENSE`) for the one-time Starter kit purchase; `/pricing` shows a "Buy the Starter kit" card when it is set.

### Changed
- `lib/billing/pricing.ts` is now a versioned catalog (`BUILTIN_PRICES`, `selectPrice`, `costFromPrice`). `costMicroUsd(model, usage)` and `PRICE_PER_MTOK` still work for existing code.
- The eval runner's `--json` report lists the price ids its costs were computed with.

### Fixed
- `docs/setup.md` pointed to the wrong file for the price table.
- `lib/billing/pricing.ts`: Claude Sonnet 5.5 cache-read price corrected to $0.10/MTok (0.05x base input, per the official pricing page on 2026-11-01); it was $0.20.

## [0.3.0] — 2026-11-01

### Added
- **Rate limiting** (`lib/ratelimit/index.ts`): database-backed sliding window per user, limit from `plans.requests_per_minute` (seeded 10 / 60 / 200 for free / pro / team). `/api/agent` answers `429` with `Retry-After` and `X-RateLimit-*` headers; the chat UI shows the wait time. Old hits are pruned on each check, no cron needed.
- **License key delivery** (`lib/licensing/index.ts`, `docs/licensing.md`): Lemon Squeezy `order_created` for `LEMONSQUEEZY_VARIANT_LICENSE` issues an `AW-XXXX-…` key (idempotent per order), invites the buyer's GitHub login to `LICENSE_GITHUB_REPO` when configured, and emails key + signed download link. `order_refunded` revokes the key. Emails go through Resend (`RESEND_API_KEY`) or are logged.
- **`/api/download?token=…`**: HMAC-signed, revocation-aware redirect to `LICENSE_DOWNLOAD_URL`, counts downloads.
- **`/admin/licenses`** (+ `/api/admin/licenses`): list/search licenses with delivery status, resend, revoke/reactivate, issue a key by hand. Access via `ADMIN_EMAILS` (`lib/auth/admin.ts`).
- `lib/email/index.ts`: minimal Resend sender with a logging fallback.
- Migration `0001_ratelimit_licenses` (tables `rate_limit_hits`, `licenses`; column `plans.requests_per_minute`).

### Changed
- Webhook schema accepts `user_name`, `order_number` and `custom_data.github`.
- `scripts/seed.ts` upserts `requests_per_minute` as well.

## [0.2.0] — 2026-11-01

### Added
- **MCP tool sources** (`lib/agent/mcp.ts`): connect stdio or Streamable HTTP MCP servers via `MCP_SERVERS`; their tools are registered as `<server>__<tool>` and callable by the agent like local tools. Per-server `allowTools` filter, graceful failure per server.
- **Eval runner** (`evals/run.ts`, `evals/cases.ts`): runs golden cases through the real agent loop without a database, checks tool calls / text / turn count, prints cost per case, exits non-zero on failure. `npm run eval -- --model … --only … --json …`.
- **Usage dashboard** (`/usage`, `lib/billing/usage.ts`): monthly tokens and cost against the plan cap, per-model split, 30-day chart, last 20 calls. Link from the chat header.
- **Magic-link sign-in** via Resend: enabled automatically when `AUTH_RESEND_KEY` is set; `/login` shows the email form only then.
- **Pricing page** (`/pricing`, `lib/billing/checkout.ts`): Free / Pro / Team cards; Pro and Team buttons become Lemon Squeezy checkout links (with `checkout[custom][user_id]` for webhook matching) once `NEXT_PUBLIC_LS_CHECKOUT_*` are set.
- `lib/billing/pricing.ts`: pure pricing table and `costMicroUsd` / `formatUsd`, usable without a database.
- `docs/deploy.md` (Vercel + Neon, other hosts) and `docs/next16.md` (upgrade evaluation — deferred).
- `defineRawTool`, `listTools`, `removeToolsFromSource` in the tool registry.

### Changed
- Pricing table corrected to current list prices (Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per MTok).
- `runAgent` no longer requires `userId`; without it, metering is skipped (used by evals and smoke tests). Metering is imported lazily so the loop works without `DATABASE_URL`.
- `.env.example` documents the new optional variables.

## [0.1.0] — 2026-11-01

Initial release: Next.js 15 app, Drizzle + Postgres schema and migrations, Auth.js v5 GitHub OAuth,
streaming agent loop with parallel tool calls and prompt caching, SSE agent route + chat UI,
per-user token metering with plan caps, Lemon Squeezy webhook with signature verification, commercial LICENSE.
