// Builds the deployable site into dist/: index.html plus /blog from
// content/posts/*.md (one folder per post, a blog index), feed.xml, sitemap.xml
// and robots.txt. `npm run deploy` runs this and uploads dist/ (functions/ is
// picked up from the repo root by wrangler).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, copyFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://agentwright.app";
const POSTS_DIR = join(root, "content/posts");
const OUT = join(root, "dist");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyFileSync(join(root, "index.html"), join(OUT, "index.html"));
// Post-checkout page: Pages serves thanks.html at /thanks (noindex, not in sitemap).
copyFileSync(join(root, "thanks.html"), join(OUT, "thanks.html"));
// Static root assets (favicons, manifest, OG image) live in public/.
cpSync(join(root, "public"), OUT, { recursive: true });

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("missing frontmatter");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) val = val.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    else if (/^".*"$/.test(val)) val = val.slice(1, -1);
    meta[key] = val;
  }
  return { meta, body: m[2] };
}

function readingTime(md) {
  const words = md.replace(/```[\s\S]*?```/g, "").split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 220))} min read`;
}

const fmtDate = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

const CSS = `
:root{--bg:#FAFAF9;--ink:#1C1917;--muted:#57534E;--primary:#0F172A;--accent:#F59E0B;--card:#FFFFFF;--line:#E7E5E4;--link:#B45309}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0C0A09;--ink:#FAFAF9;--muted:#A8A29E;--primary:#F5F5F4;--card:#1C1917;--line:#292524;--link:#FBBF24}}
:root[data-theme="dark"]{--bg:#0C0A09;--ink:#FAFAF9;--muted:#A8A29E;--primary:#F5F5F4;--card:#1C1917;--line:#292524;--link:#FBBF24}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,sans-serif;line-height:1.6}
.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
header{display:flex;justify-content:space-between;align-items:center;padding:20px 0;flex-wrap:wrap;gap:10px 20px}
.logo{font-weight:700;font-size:20px;letter-spacing:-.02em;text-decoration:none;color:var(--ink);border-bottom:3px solid var(--accent);line-height:1}
nav{display:flex;flex-wrap:wrap;gap:6px 20px}nav a{color:var(--muted);text-decoration:none;font-size:15px;white-space:nowrap}
main{max-width:720px;margin:0 auto;padding:24px 0 48px}
h1{font-size:clamp(30px,5vw,42px);line-height:1.12;letter-spacing:-.03em;margin:16px 0 12px}
.meta{color:var(--muted);font-size:15px;margin-bottom:32px}
.lede{font-size:19px;color:var(--muted)}
article h2{font-size:24px;letter-spacing:-.02em;margin:44px 0 12px}
article h3{font-size:19px;margin:32px 0 8px}
article p,article li{font-size:17px}
article a{color:var(--link)}
code,pre{font-family:"JetBrains Mono",ui-monospace,monospace}
code{font-size:.92em;background:var(--card);border:1px solid var(--line);border-radius:5px;padding:1px 5px}
pre{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;overflow:auto;font-size:14px;line-height:1.5}
pre code{background:none;border:0;padding:0;font-size:inherit}
table{border-collapse:collapse;width:100%;margin:16px 0;font-size:15px;display:block;overflow-x:auto}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--muted);font-weight:600}
hr{border:0;border-top:1px solid var(--line);margin:40px 0}
blockquote{margin:0;padding-left:16px;border-left:3px solid var(--accent);color:var(--muted)}
.post-list{list-style:none;padding:0;margin:0}
.post-list li{padding:22px 0;border-bottom:1px solid var(--line)}
.post-list a.t{font-size:22px;font-weight:600;letter-spacing:-.02em;color:var(--ink);text-decoration:none}
.post-list a.t:hover{color:var(--link)}
.post-list p{margin:8px 0 0;color:var(--muted)}
.cta{border:1px solid var(--line);border-radius:14px;padding:22px;background:var(--card);margin-top:40px}
.cta p{margin:0 0 12px}
.btn{display:inline-block;background:var(--primary);color:var(--bg);padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none;font-size:15px}
.comments{margin-top:48px;border-top:1px solid var(--line);padding-top:8px}
.comments h2{font-size:22px;letter-spacing:-.02em;margin:24px 0 6px}
.comments .hint{color:var(--muted);font-size:14px;margin:0 0 20px}
.c-item{padding:14px 0;border-bottom:1px solid var(--line)}
.c-item.reply{margin-left:22px;padding-left:14px;border-left:2px solid var(--accent);border-bottom:0}
.c-head{font-size:14px;color:var(--muted);margin-bottom:6px}
.c-head b{color:var(--ink)}
.c-team{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:1px 6px;margin-left:6px}
.c-body{white-space:pre-wrap;font-size:16px;margin:0}
.c-form{display:grid;gap:10px;margin-top:20px}
.c-form input,.c-form textarea{font:inherit;font-size:16px;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px;width:100%;box-sizing:border-box}
.c-form textarea{min-height:120px;resize:vertical}
.c-form button{justify-self:start;border:0;cursor:pointer}
.c-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.c-msg{font-size:14px;color:var(--muted);min-height:1em;margin:0}
footer{padding:36px 0;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}
footer a{color:inherit}
.faq h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:48px 0 4px}
.faq h3{font-size:19px;margin:28px 0 6px}
.faq p{margin:0 0 10px}
`;

function page({ title, description, url, body, meta = "", type = "website" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="alternate" type="application/rss+xml" title="Agentwright blog" href="${SITE}/feed.xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0F172A">
<meta property="og:site_name" content="Agentwright">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="https://agentwright.app/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:image" content="https://agentwright.app/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${meta}<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header><a class="logo" href="/">agentwright</a><nav><a href="/#features">What's inside</a><a href="/#pricing">Pricing</a><a href="/tools/">Tools</a><a href="/blog/">Blog</a><a href="/faq/">FAQ</a><a href="https://github.com/agentwright-app">GitHub</a></nav></header>
<main>
${body}
</main>
<footer>© 2026 Agentwright · <a href="/tools/">Tools</a> · <a href="/blog/">Blog</a> · <a href="/feed.xml">RSS</a> · <a href="/faq/">FAQ</a> · <a href="/legal/">Refunds &amp; license</a> · <a href="mailto:hello@agentwright.app">hello@agentwright.app</a></footer>
</div>
</body>
</html>
`;
}

function commentsBlock(slug) {
  return `<section class="comments" id="comments" data-slug="${esc(slug)}">
<h2>Comments</h2>
<p class="hint">Questions and corrections welcome. Replies marked Agentwright are written with AI assistance and reviewed against the post. Comments with links are held for review.</p>
<div id="c-list"><p class="c-msg">Loading comments…</p></div>
<form class="c-form" id="c-form" novalidate>
<input name="name" maxlength="60" placeholder="Your name" autocomplete="name" required>
<textarea name="body" maxlength="2000" placeholder="Your comment" required></textarea>
<div class="c-hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
<button class="btn" type="submit">Post comment</button>
<p class="c-msg" id="c-msg" role="status"></p>
</form>
</section>
<script>
(() => {
  const sec = document.getElementById("comments"), slug = sec.dataset.slug;
  const list = document.getElementById("c-list"), form = document.getElementById("c-form"), msg = document.getElementById("c-msg");
  const opened = Date.now();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (iso) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  function item(c, isReply) {
    const d = el("div", "c-item" + (isReply ? " reply" : ""));
    const h = el("div", "c-head"); h.append(el("b", null, c.name));
    if (c.team) h.append(el("span", "c-team", "Agentwright"));
    h.append(" · " + fmt(c.createdAt));
    d.append(h, el("p", "c-body", c.body));
    return d;
  }
  function render(cs) {
    list.textContent = "";
    const top = cs.filter((c) => !c.parent || !cs.some((p) => p.id === c.parent));
    if (!top.length) { list.append(el("p", "c-msg", "No comments yet. Be the first to ask a question.")); return; }
    for (const c of top) {
      list.append(item(c, false));
      for (const r of cs.filter((x) => x.parent === c.id)) list.append(item(r, true));
    }
  }
  let current = [];
  fetch("/api/comments?slug=" + encodeURIComponent(slug)).then((r) => r.json()).then((d) => { current = d.comments || []; render(current); })
    .catch(() => { list.textContent = ""; list.append(el("p", "c-msg", "Comments could not be loaded.")); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const payload = { slug, name: String(f.get("name") || ""), body: String(f.get("body") || ""), website: String(f.get("website") || ""), ts: opened };
    if (!payload.name.trim() || payload.body.trim().length < 2) { msg.textContent = "Please add your name and a comment."; return; }
    msg.textContent = "Posting…";
    try {
      const r = await fetch("/api/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok || !d.ok) { msg.textContent = d.error || "Something went wrong. Please try again."; return; }
      form.reset();
      if (d.comment) { current.push(d.comment); render(current); msg.textContent = "Thanks! Your comment is live."; }
      else msg.textContent = "Thanks! Your comment will appear after a quick review.";
    } catch { msg.textContent = "Network error. Please try again."; }
  });
})();
</script>`;
}

// Scheduled publishing: a post goes live on its `date` (Korea time) WITHOUT a new deploy.
// Every non-draft post page is built, and functions/_middleware.ts decides at request time:
//  - /blog/<slug>/ of a post dated after today (Asia/Seoul) → 404;
//  - /blog/, /feed.xml, /sitemap.xml → the snapshot in dist/_asof/<date>/ for today
//    (one snapshot per future publish date, built here; dist/_schedule.json lists them).
// The root /blog/, /feed.xml and /sitemap.xml are today's versions (fallback if the
// middleware is missing). `draft: true` posts are never built.
// BLOG_PREVIEW=1 treats every post as live (local preview only, never deploy with it).
const TODAY = process.env.BLOG_TODAY ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const PREVIEW = process.env.BLOG_PREVIEW === "1";
const allPosts = readdirSync(POSTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const { meta, body } = parseFrontmatter(readFileSync(join(POSTS_DIR, f), "utf8"));
    const slug = meta.slug ?? f.replace(/\.md$/, "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date ?? "")) throw new Error(`${f}: date must be YYYY-MM-DD`);
    return { ...meta, slug, body, url: `${SITE}/blog/${slug}/`, reading: readingTime(body), html: marked.parse(body) };
  })
  .sort((a, b) => (a.date < b.date ? 1 : -1));
const built = allPosts.filter((p) => PREVIEW || p.draft !== "true");
const liveOn = (day) => built.filter((p) => PREVIEW || p.date <= day);
const posts = liveOn(TODAY);
const queued = built.filter((p) => !posts.includes(p)).sort((a, b) => (a.date < b.date ? -1 : 1));
const futureDates = [...new Set(queued.map((p) => p.date))].sort();

for (const p of built) {
  const dir = join(OUT, "blog", p.slug);
  mkdirSync(dir, { recursive: true });
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: p.title,
    description: p.description,
    datePublished: p.date,
    dateModified: p.date,
    url: p.url,
    author: { "@type": "Organization", name: "Agentwright", url: SITE },
    publisher: { "@type": "Organization", name: "Agentwright", url: SITE },
  };
  const body = `<article>
<p class="meta"><a href="/blog/" style="color:inherit;text-decoration:none">← Blog</a></p>
<h1>${esc(p.title)}</h1>
<p class="meta"><time datetime="${p.date}">${fmtDate(p.date)}</time> · ${p.reading}</p>
${p.html}
</article>
<div class="cta"><p><strong>Agentwright Starter</strong> ships this metering layer, the agent loop, auth, Lemon Squeezy billing, MCP and evals as one Next.js codebase. Launching December 2026 at $99.</p><a class="btn" href="/#waitlist">Join the launch list</a></div>
${commentsBlock(p.slug)}`;
  const meta = `<meta property="article:published_time" content="${p.date}T00:00:00Z">
${(p.tags ?? []).map((t) => `<meta property="article:tag" content="${esc(t)}">`).join("\n")}
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
`;
  writeFileSync(join(dir, "index.html"), page({ title: `${p.title} — Agentwright`, description: p.description, url: p.url, body, meta, type: "article" }));
}

// Blog index
function writeIndexAndFeed(base, posts) {
mkdirSync(join(base, "blog"), { recursive: true });
const list = posts
  .map(
    (p) => `<li><a class="t" href="/blog/${p.slug}/">${esc(p.title)}</a><p class="meta" style="margin:6px 0 0"><time datetime="${p.date}">${fmtDate(p.date)}</time> · ${p.reading}</p><p>${esc(p.description)}</p></li>`,
  )
  .join("\n");
writeFileSync(
  join(base, "blog/index.html"),
  page({
    title: "Blog — Agentwright",
    description: "Practical notes on building Claude-powered SaaS: metering, billing, agent loops, MCP and evals. From the team behind Agentwright Starter.",
    url: `${SITE}/blog/`,
    body: `<h1>Blog</h1><p class="lede">Practical notes on building Claude-powered SaaS: metering, billing, agent loops, MCP and evals.</p><ul class="post-list">${list}</ul>`,
  }),
);

// RSS
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>Agentwright blog</title>
<link>${SITE}/blog/</link>
<description>Practical notes on building Claude-powered SaaS.</description>
<language>en</language>
<lastBuildDate>${new Date(posts[0]?.date + "T00:00:00Z").toUTCString()}</lastBuildDate>
<atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
${posts
  .map(
    (p) => `<item>
<title>${esc(p.title)}</title>
<link>${p.url}</link>
<guid isPermaLink="true">${p.url}</guid>
<pubDate>${new Date(p.date + "T00:00:00Z").toUTCString()}</pubDate>
<description>${esc(p.description)}</description>
<content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/"><![CDATA[${p.html}]]></content:encoded>
</item>`,
  )
  .join("\n")}
</channel>
</rss>
`;
writeFileSync(join(base, "feed.xml"), rss);
}
writeIndexAndFeed(OUT, posts);
for (const d of futureDates) writeIndexAndFeed(join(OUT, "_asof", d), liveOn(d));
writeFileSync(
  join(OUT, "_schedule.json"),
  JSON.stringify({ builtOn: TODAY, posts: Object.fromEntries(built.map((p) => [p.slug, p.date])), asof: futureDates }),
);

// Tools: static pages under tools/<slug>/ are copied as-is; the cost calculator
// gets its pricing.json inlined so the page renders without a second request.
const TOOLS_DIR = join(root, "tools");
const tools = readdirSync(TOOLS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => {
    const src = join(TOOLS_DIR, d.name);
    const html = readFileSync(join(src, "index.html"), "utf8");
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? d.name;
    const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
    return { slug: d.name, src, html, title: title.split(" — ")[0], description };
  });
for (const t of tools) {
  const dir = join(OUT, "tools", t.slug);
  cpSync(t.src, dir, { recursive: true });
  let html = t.html;
  try {
    // Tools without their own pricing.json share the cost calculator's table.
    let pricing;
    try { pricing = readFileSync(join(t.src, "pricing.json"), "utf8"); }
    catch { pricing = readFileSync(join(TOOLS_DIR, "claude-api-cost-calculator/pricing.json"), "utf8"); }
    html = html.replace("__PRICING_JSON__", JSON.stringify(JSON.parse(pricing)));
  } catch {}
  writeFileSync(join(dir, "index.html"), html);
}
const toolList = tools
  .map((t) => `<li><a class="t" href="/tools/${t.slug}/">${esc(t.title)}</a><p>${t.description}</p></li>`)
  .join("\n");
writeFileSync(
  join(OUT, "tools/index.html"),
  page({
    title: "Free tools — Agentwright",
    description: "Free calculators and templates for teams building Claude-powered products.",
    url: `${SITE}/tools/`,
    body: `<h1>Tools</h1><p class="lede">Free calculators and templates for teams building Claude-powered products. No sign-up.</p><ul class="post-list">${toolList}</ul>`,
  }),
);

// Sitemap (today + one snapshot per future publish date)
function writeSitemap(base, posts) {
const urls = [
  { loc: `${SITE}/`, lastmod: posts[0]?.date ?? "2026-11-01", priority: "1.0" },
  { loc: `${SITE}/tools/`, lastmod: "2026-11-01", priority: "0.8" },
  ...tools.map((t) => ({ loc: `${SITE}/tools/${t.slug}/`, lastmod: "2026-11-01", priority: "0.8" })),
  { loc: `${SITE}/faq/`, lastmod: "2026-11-04", priority: "0.6" },
  { loc: `${SITE}/legal/`, lastmod: "2026-11-03", priority: "0.3" },
  { loc: `${SITE}/blog/`, lastmod: posts[0]?.date ?? "2026-11-01", priority: "0.8" },
  ...posts.map((p) => ({ loc: p.url, lastmod: p.date, priority: "0.7" })),
];
writeFileSync(
  join(base, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join("\n")}
</urlset>
`,
);
}
writeSitemap(OUT, posts);
for (const d of futureDates) writeSitemap(join(OUT, "_asof", d), liveOn(d));
writeFileSync(
  join(OUT, "404.html"),
  page({
    title: "Page not found — Agentwright",
    description: "That page does not exist.",
    url: `${SITE}/404`,
    body: `<h1>Page not found</h1><p class="lede">That page does not exist. Try the <a href="/">home page</a> or the <a href="/blog/">blog</a>.</p>`,
  }),
);
// /legal/: refund policy + license terms, from content/pages/legal.md.
{
  const dir = join(OUT, "legal");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    page({
      title: "Refund policy & license terms — Agentwright",
      description: "14-day no-questions refund, and what the Agentwright Starter license lets you do.",
      url: `${SITE}/legal/`,
      body: `<h1>Refund policy &amp; license terms</h1>\n<article>\n${marked.parse(readFileSync(join(root, "content/pages/legal.md"), "utf8"))}</article>`,
    }),
  );
}
// /faq/: pre-launch FAQ from content/pages/faq.md ("## Group" / "### Question" + answer).
// Emits FAQPage structured data built from the same Markdown.
{
  const md = readFileSync(join(root, "content/pages/faq.md"), "utf8");
  const qa = md
    .split(/^### /m)
    .slice(1)
    .map((chunk) => {
      const [q, ...rest] = chunk.split("\n");
      const answer = rest.join("\n").split(/^## /m)[0].trim();
      return { q: q.trim(), a: marked.parse(answer) };
    });
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a.trim() } })),
  };
  const dir = join(OUT, "faq");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    page({
      title: "FAQ — Agentwright Starter",
      description: "Price, refunds, license, what's inside, tech stack and updates for Agentwright Starter, the Claude agent SaaS starter kit.",
      url: `${SITE}/faq/`,
      meta: `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>\n`,
      body: `<h1>Frequently asked questions</h1>\n<p class="lede">Everything about buying and using Agentwright Starter. Not answered here? Email <a href="mailto:hello@agentwright.app" style="color:inherit">hello@agentwright.app</a>.</p>\n<article class="faq">\n${marked.parse(md)}</article>\n<div class="cta"><p><strong>Launch price $99</strong> (list $149) for the first 50 licenses. Sales open in December 2026.</p><a class="btn" href="/#waitlist">Join the launch list</a></div>`,
    }),
  );
}
writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

// Cookieless visit counter (functions/api/hit.ts): add one beacon to every HTML page in dist/.
{
  // Owner opt-out: open any page once with ?notrack=1 (per browser/device) to stop counting your own visits; ?notrack=0 undoes it.
  const BEACON = `<script>var n=0;try{var q=new URLSearchParams(location.search).get("notrack");if(q==="1")localStorage.setItem("aw_notrack","1");if(q==="0")localStorage.removeItem("aw_notrack");n=localStorage.getItem("aw_notrack")}catch(e){}try{if(!n)navigator.sendBeacon("/api/hit",JSON.stringify({p:location.pathname,r:document.referrer}))}catch(e){}</script>`;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith(".html")) {
        const html = readFileSync(f, "utf8");
        if (!html.includes("/api/hit") && html.includes("</body>")) writeFileSync(f, html.replace(/<\/body>(?![\s\S]*<\/body>)/, `${BEACON}\n</body>`));
      }
    }
  };
  walk(OUT);
}

console.log(`today ${TODAY}${PREVIEW ? " (PREVIEW: future posts included)" : ""}; queued: ${queued.map((p) => `${p.date} ${p.slug}`).join(", ") || "none"}`);
console.log(`dist/ ready — ${posts.length} post(s): ${posts.map((p) => p.slug).join(", ")}; ${tools.length} tool(s): ${tools.map((t) => t.slug).join(", ")}`);
