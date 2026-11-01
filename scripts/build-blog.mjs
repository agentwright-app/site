// Builds the deployable site into dist/: index.html plus /blog from
// content/posts/*.md (one folder per post, a blog index), feed.xml, sitemap.xml
// and robots.txt. `npm run deploy` runs this and uploads dist/ (functions/ is
// picked up from the repo root by wrangler).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, copyFileSync } from "node:fs";
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
header{display:flex;justify-content:space-between;align-items:center;padding:20px 0}
.logo{font-weight:700;font-size:20px;letter-spacing:-.02em;text-decoration:none;color:var(--ink);border-bottom:3px solid var(--accent);line-height:1}
nav a{color:var(--muted);text-decoration:none;margin-left:20px;font-size:15px}
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
footer{padding:36px 0;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}
footer a{color:inherit}
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
<meta property="og:site_name" content="Agentwright">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${meta}<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header><a class="logo" href="/">agentwright</a><nav><a href="/blog/">Blog</a><a href="/#pricing">Pricing</a><a href="https://github.com/agentwright-app">GitHub</a></nav></header>
<main>
${body}
</main>
<footer>© 2026 Agentwright · <a href="/blog/">Blog</a> · <a href="/feed.xml">RSS</a> · <a href="mailto:hello@agentwright.app">hello@agentwright.app</a></footer>
</div>
</body>
</html>
`;
}

const posts = readdirSync(POSTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const { meta, body } = parseFrontmatter(readFileSync(join(POSTS_DIR, f), "utf8"));
    const slug = meta.slug ?? f.replace(/\.md$/, "");
    return { ...meta, slug, body, url: `${SITE}/blog/${slug}/`, reading: readingTime(body), html: marked.parse(body) };
  })
  .sort((a, b) => (a.date < b.date ? 1 : -1));

for (const p of posts) {
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
<div class="cta"><p><strong>Agentwright Starter</strong> ships this metering layer, the agent loop, auth, Lemon Squeezy billing, MCP and evals as one Next.js codebase. Launching December 2026 at $99.</p><a class="btn" href="/#waitlist">Join the launch list</a></div>`;
  const meta = `<meta property="article:published_time" content="${p.date}T00:00:00Z">
${(p.tags ?? []).map((t) => `<meta property="article:tag" content="${esc(t)}">`).join("\n")}
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
`;
  writeFileSync(join(dir, "index.html"), page({ title: `${p.title} — Agentwright`, description: p.description, url: p.url, body, meta, type: "article" }));
}

// Blog index
mkdirSync(join(OUT, "blog"), { recursive: true });
const list = posts
  .map(
    (p) => `<li><a class="t" href="/blog/${p.slug}/">${esc(p.title)}</a><p class="meta" style="margin:6px 0 0"><time datetime="${p.date}">${fmtDate(p.date)}</time> · ${p.reading}</p><p>${esc(p.description)}</p></li>`,
  )
  .join("\n");
writeFileSync(
  join(OUT, "blog/index.html"),
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
writeFileSync(join(OUT, "feed.xml"), rss);

// Sitemap
const urls = [
  { loc: `${SITE}/`, lastmod: posts[0]?.date ?? "2026-11-01", priority: "1.0" },
  { loc: `${SITE}/blog/`, lastmod: posts[0]?.date ?? "2026-11-01", priority: "0.8" },
  ...posts.map((p) => ({ loc: p.url, lastmod: p.date, priority: "0.7" })),
];
writeFileSync(
  join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join("\n")}
</urlset>
`,
);
writeFileSync(
  join(OUT, "404.html"),
  page({
    title: "Page not found — Agentwright",
    description: "That page does not exist.",
    url: `${SITE}/404`,
    body: `<h1>Page not found</h1><p class="lede">That page does not exist. Try the <a href="/">home page</a> or the <a href="/blog/">blog</a>.</p>`,
  }),
);
writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`dist/ ready — ${posts.length} post(s): ${posts.map((p) => p.slug).join(", ")}`);
