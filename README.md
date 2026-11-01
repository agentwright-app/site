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
npm run deploy         # wrangler pages deploy (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)
```

## Blog
Posts are Markdown files in `content/posts/*.md` (frontmatter: title, description, date, slug, tags).
`npm run build:blog` renders them to `blog/<slug>/index.html`, `blog/index.html`, `feed.xml`, `sitemap.xml`
and `robots.txt` (generated files are committed so the deploy stays a plain static upload). `npm run deploy`
runs the build first. Drafts/outlines live in `content/drafts/` and are not built. `.assetsignore` keeps
sources out of the Pages upload.
