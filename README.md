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
