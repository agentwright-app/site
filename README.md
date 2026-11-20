# agentwright.app

This repository is the source of [agentwright.app](https://agentwright.app/?utm_source=github-readme):
a free remote MCP server for Claude API prices, three Claude cost calculators, a blog, and the
marketing site and license delivery for Agentwright Starter, a paid Next.js starter kit. Everything
runs on Cloudflare Pages and one Cloudflare Worker.

## Free Claude pricing MCP server

`https://agentwright.app/mcp` answers "what will this cost on Claude?" from a dated price table
instead of a guess. No sign-up, no API key, nothing to install.

```bash
claude mcp add --transport http claude-pricing https://agentwright.app/mcp
```

Other clients (Claude desktop app, Cursor, VS Code):
[setup on the tool page](https://agentwright.app/tools/claude-pricing-mcp/?utm_source=github-readme).

| Tool | Returns |
|---|---|
| `list_claude_models` | Every current Claude model with input, output, cache-write (5 min / 1 h) and cache-read prices per million tokens, the Batch API discount and long-prompt prices |
| `estimate_claude_cost` | Cost per request and in total from token counts, with prompt caching, Batch API and long-prompt pricing |
| `compare_claude_models` | The same workload on every Claude model, cheapest first |

Every answer states the date of the price table it used. The server is read-only and stateless:
it does not log or store requests. It is listed in the official MCP Registry as
`app.agentwright/claude-pricing` ([`mcp/server.json`](mcp/server.json)).

The source is one file, [`functions/mcp.ts`](functions/mcp.ts) (about 220 lines): MCP Streamable
HTTP on a Cloudflare Pages Function with no dependencies, so it also works as an example of a
remote MCP server without an SDK
([write-up](https://agentwright.app/blog/remote-mcp-server-cloudflare-without-sdk/?utm_source=github-readme)).
It reads the same [`pricing.json`](tools/claude-api-cost-calculator/pricing.json) as the calculators.

**Licence:** this repository has no open-source licence yet, so its code is not licensed for reuse.
The hosted server is free to use. If you want to reuse `functions/mcp.ts`, write to
hello@agentwright.app. Wrong price? Same address.

## Free calculators

- [Claude API cost calculator](https://agentwright.app/tools/claude-api-cost-calculator/?utm_source=github-readme) ([source](tools/claude-api-cost-calculator/))
- [Prompt caching savings calculator](https://agentwright.app/tools/prompt-caching-savings-calculator/?utm_source=github-readme) ([source](tools/prompt-caching-savings-calculator/))
- [AI SaaS margin calculator](https://agentwright.app/tools/ai-saas-margin-calculator/?utm_source=github-readme) ([source](tools/ai-saas-margin-calculator/))

## What else is in this repository

A complete, working Cloudflare Pages site that sells a digital product:

- [`functions/api/webhooks/polar.ts`](functions/api/webhooks/polar.ts): the seller webhook. It
  verifies the signature, issues a license key into KV on a paid order, revokes it on a full refund,
  and gives the same result when an event arrives twice. [`functions/api/download.ts`](functions/api/download.ts)
  serves the zip behind a signed link.
- [`functions/api/hit.ts`](functions/api/hit.ts) and [`lib/stats.ts`](lib/stats.ts): a cookie-free
  visit counter in one KV document per day, with a daily write cap for the free plan.
- [`workers/cron/`](workers/cron/): a Worker on a schedule that posts queued updates and pings IndexNow.
- [`scripts/build-blog.mjs`](scripts/build-blog.mjs): Markdown blog with posts that go live on their
  date without a new deploy (`functions/_middleware.ts`).

## Agentwright Starter (the paid kit)

The kit itself is not in this repository. It is a Next.js and TypeScript starter for a Claude agent
SaaS: a streaming agent loop with tools and MCP clients, per-user cost metering with price
snapshots, plan caps, rate limits, auth, and billing through Polar or Lemon Squeezy, on Postgres.
You can read its file map, three source files in full, and its docs and changelog before buying, at
[agentwright.app/inside](https://agentwright.app/inside/?utm_source=github-readme). It is $99 for
the first 50 licenses, then $149, with a 14-day refund.

---

## Working on this site

Static HTML, deployed on Cloudflare Pages.

- `index.html` — landing page. It is a template: `npm run build:blog` fills its `{{TOKENS}}`
  (version, release date, line and test counts, model list, changelog, code excerpt, screenshots,
  product JSON-LD) from `content/kit/` and writes the result to `dist/index.html`. An unknown token
  fails the build. Open the built page, not the template.

### Kit preview (`/inside/`, `/docs/`, `/changelog/`)
`content/kit/` holds the public preview of Agentwright Starter. It is generated, so don't edit it by hand.
After every Starter release, run it against a git checkout of the Starter, then commit and deploy:

```bash
node scripts/sync-kit-preview.mjs /path/to/starter
```

This repository is public. Only the source files named in `PREVIEW_FILES` (`lib/agent/loop.ts`,
`lib/billing/metering.ts`, `evals/cases.ts`) are copied in full, plus the buyer docs in `DOCS`,
`CHANGELOG.md`, `ci.yml` and `.env.example`. Every other file appears by name and line count only
(`meta.json`, with one-line notes from the Starter README's Layout block in `layout.txt`).

`scripts/lib/kit-pages.mjs` builds from it:
- `/inside/`: the file map with notes, all files with line counts, the three preview files in full, tests and CI
- `/docs/` and `/docs/setup/`, `/docs/deploy/`, `/docs/price-snapshots/`, `/docs/license-delivery/`
- `/changelog/`: the Starter's changelog
- the landing page tokens (`renderLanding`, see `index.html` above)

`public/shots/shots.json` is optional: `{ version, items[] }` with product screenshots or a video in
`public/shots/`. When it exists, the landing page gets a screenshots section; `version` is the kit
version that was photographed.

`content/kit-runs/` is optional: `runs.json` (`{ version, date }`) plus `test.txt` and `eval.txt`, the
real terminal output of `npm test` and `npm run eval -- --model claude-haiku-5-5`. `/inside/` shows it
only while `version` equals the synced kit version, so run both commands again after every Starter
release.

`content/compare/*.json` builds one page per file at `/<slug>/` (`scripts/lib/compare-page.mjs`).
Every fact about another product carries its source URL, and `checked` is the date shown on the page
and used as the sitemap `lastmod`. Re-check the sources every month and update `checked`.

### Visit and click counts
The build injects a small beacon into every page except the 404 page. Three seconds after the page
became visible it posts the path, the referrer and any `?utm_source=` to `/api/hit`
(`functions/api/hit.ts`), which keeps only daily counters in the `STATS` KV namespace, one JSON
document per day: page views, unique visitors, referrers, `utm` sources, network operators, and two
click events per page, `buy_click` (a link to `buy.polar.sh`) and `preview_click` (a link whose `href`
starts with `/inside/`). Use exactly those hrefs for buy and preview links, or the clicks are not
counted. `?notrack=1` turns counting off in your own browser (`?notrack=0` turns it back on).

Automated clients are not counted: automated browsers, requests that do not come from our own pages,
bot user agents and cloud hosts. The counter also stops for the day after 400 KV writes
(`DAILY_WRITE_CAP` in `lib/stats.ts`), because the free plan's 1,000 writes a day are shared with
license issuing. A page view costs one write and a new visitor two, so a day holds about 130 to 200
visitors before counting stops; the site and sales are not affected when it does.

`node scripts/stats.mjs [since YYYY-MM-DD]` prints the totals (needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`), the writes the counter used per day, and a note on days known to be wrong.

### Launch-list signup
`functions/api/subscribe.ts` is a Cloudflare Pages Function behind the form on the landing page.
It stores signups in the KV namespace bound as `WAITLIST` (Pages project → Settings → Bindings),
with a honeypot, a 2-second minimum fill time and a per-IP limit of 5/hour.
`GET /api/subscribe` reports whether the binding is present.

```bash
npm install
npm run typecheck      # type-checks functions/
npm run dev            # local preview with an in-memory WAITLIST KV
npm run deploy         # build:blog + wrangler pages deploy dist (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)
```

### Blog
Posts are Markdown files in `content/posts/*.md` (frontmatter: title, description, date, slug, tags).
`npm run build:blog` writes the deployable site to `dist/` (gitignored): `index.html`, `blog/<slug>/index.html`,
`blog/index.html`, `feed.xml`, `sitemap.xml`, `robots.txt`. `npm run deploy` runs the build and uploads `dist/`
(wrangler picks up `functions/` from the repo root). Drafts/outlines live in `content/drafts/` and are not built.
`BLOG_OUT=/tmp/some-dir npm run build:blog` builds into another folder instead of `dist/` (for test builds).

#### Call to action per post
`content/post-cta.json` maps a post slug to `{ text, files[] }`: the kit box under that post. File paths
in `files` are shown as code. Every sentence must be true for the current kit. A slug that matches no
post fails the build; a post without an entry gets a neutral default text.

#### Scheduled posts
A post goes live on its frontmatter `date` (Korea time) **without a new deploy**. The build renders every
non-draft post, plus `dist/_schedule.json` and one snapshot of `/blog/`, `feed.xml` and `sitemap.xml` per
future publish date under `dist/_asof/<date>/`. `functions/_middleware.ts` then returns 404 for posts dated
after today and serves the snapshot for today. So queue posts by committing them with a future date and
running `npm run deploy` once. `draft: true` posts are never built.
`BLOG_PREVIEW=1 npm run build:blog` treats every post as live (local preview only, never deploy with it).

#### dev.to cross-posts
`content/devto-schedule.json` lists `{slug, date, tags}`. `node scripts/devto-crosspost.mjs` (run by a daily scheduled job,
needs `DEVTO_API_KEY`) publishes at most one due post per run with `canonical_url` set to our post, skipping anything
already on dev.to. Text between `<!-- site-only -->` and `<!-- /site-only -->` is removed for dev.to (no self-promotion
there), and the AI disclosure + "questions go to the original post's comments" closing is appended.
`--dry-run` writes the converted bodies to `dist-devto/` for review.
