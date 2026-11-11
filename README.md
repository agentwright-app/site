# agentwright.app

Marketing site for Agentwright. Static HTML, deployed on Cloudflare Pages.

- `index.html` — landing page. It is a template: `npm run build:blog` fills its `{{TOKENS}}`
  (version, release date, line and test counts, model list, changelog, code excerpt, screenshots,
  product JSON-LD) from `content/kit/` and writes the result to `dist/index.html`. An unknown token
  fails the build. Open the built page, not the template.

## Kit preview (`/inside/`, `/docs/`, `/changelog/`)
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

## Visit and click counts
The build injects a small beacon into every page. It posts the path, the referrer and any
`?utm_source=` to `/api/hit` (`functions/api/hit.ts`), which keeps only daily counters in the `STATS` KV
namespace: page views, unique visitors, referrers, `utm` sources, and two click events per page,
`buy_click` (a link to `buy.polar.sh`) and `preview_click` (a link whose `href` starts with `/inside/`).
Use exactly those hrefs for buy and preview links, or the clicks are not counted. `?notrack=1` turns
counting off in your own browser (`?notrack=0` turns it back on).
`node scripts/stats.mjs [since YYYY-MM-DD]` prints the totals (needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`).

## Launch-list signup
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

## Blog
Posts are Markdown files in `content/posts/*.md` (frontmatter: title, description, date, slug, tags).
`npm run build:blog` writes the deployable site to `dist/` (gitignored): `index.html`, `blog/<slug>/index.html`,
`blog/index.html`, `feed.xml`, `sitemap.xml`, `robots.txt`. `npm run deploy` runs the build and uploads `dist/`
(wrangler picks up `functions/` from the repo root). Drafts/outlines live in `content/drafts/` and are not built.
`BLOG_OUT=/tmp/some-dir npm run build:blog` builds into another folder instead of `dist/` (for test builds).

### Call to action per post
`content/post-cta.json` maps a post slug to `{ text, files[] }`: the kit box under that post. File paths
in `files` are shown as code. Every sentence must be true for the current kit. A slug that matches no
post fails the build; a post without an entry gets a neutral default text.

### Scheduled posts
A post goes live on its frontmatter `date` (Korea time) **without a new deploy**. The build renders every
non-draft post, plus `dist/_schedule.json` and one snapshot of `/blog/`, `feed.xml` and `sitemap.xml` per
future publish date under `dist/_asof/<date>/`. `functions/_middleware.ts` then returns 404 for posts dated
after today and serves the snapshot for today. So queue posts by committing them with a future date and
running `npm run deploy` once. `draft: true` posts are never built.
`BLOG_PREVIEW=1 npm run build:blog` treats every post as live (local preview only, never deploy with it).

### dev.to cross-posts
`content/devto-schedule.json` lists `{slug, date, tags}`. `node scripts/devto-crosspost.mjs` (run by a daily scheduled job,
needs `DEVTO_API_KEY`) publishes at most one due post per run with `canonical_url` set to our post, skipping anything
already on dev.to. Text between `<!-- site-only -->` and `<!-- /site-only -->` is removed for dev.to (no self-promotion
there), and the AI disclosure + "questions go to the original post's comments" closing is appended.
`--dry-run` writes the converted bodies to `dist-devto/` for review.
