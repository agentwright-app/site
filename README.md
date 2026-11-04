# agentwright.app

Marketing site for Agentwright. Static HTML, deployed on Cloudflare Pages.

- `index.html` — landing page

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

### Scheduled posts
A post goes live on its frontmatter `date` (Korea time): future-dated posts and `draft: true` are left out of
every page, the feed and the sitemap. A daily scheduled job runs `npm run deploy`, so queued posts appear on their day.
`BLOG_PREVIEW=1 npm run build:blog` builds everything for a local preview (never deploy with it).

### dev.to cross-posts
`content/devto-schedule.json` lists `{slug, date, tags}`. `node scripts/devto-crosspost.mjs` (run by the same daily job,
needs `DEVTO_API_KEY`) publishes at most one due post per run with `canonical_url` set to our post, skipping anything
already on dev.to. Text between `<!-- site-only -->` and `<!-- /site-only -->` is removed for dev.to (no self-promotion
there), and the AI disclosure + "questions go to the original post's comments" closing is appended.
`--dry-run` writes the converted bodies to `dist-devto/` for review.
