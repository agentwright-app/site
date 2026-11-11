// Builds /compare/ai-saas-boilerplates/ from content/compare/ai-saas-boilerplates.json.
// Every fact about another kit lives in that JSON with its source URL and the check date,
// so the page can be re-checked monthly by editing data only. Called from build-blog.mjs:
//   const compareUrls = buildComparePages({ page, esc, SITE, OUT, root });
//   const compareChecked = compareLastmod({ SITE, root }); // sitemap lastmod = each page's `checked`
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const fmtDay = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

// The wide table scrolls inside its own box on a phone; the page itself never scrolls sideways.
const STYLE = `<style>
.cmp-note{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:10px;background:var(--card);padding:14px 16px;margin:20px 0;font-size:16px}
.cmp-note p{margin:0}
.cmp-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:16px 0 8px;border:1px solid var(--line);border-radius:12px;max-width:100%}
@media (min-width:1000px){.cmp-wrap{width:min(1200px,calc(100vw - 48px));max-width:none;position:relative;left:50%;transform:translateX(-50%)}}
.cmp-wrap table{display:table;margin:0;min-width:1160px;font-size:14px;line-height:1.45}
.cmp-wrap th,.cmp-wrap td{white-space:normal;vertical-align:top;min-width:150px}
.cmp-wrap thead th{position:sticky;top:0;background:var(--bg)}
.cmp-wrap th[scope=row]{position:sticky;left:0;z-index:1;background:var(--bg);min-width:120px;color:var(--ink);border-right:1px solid var(--line)}
.cmp-wrap thead th:first-child{left:0;z-index:2}
@media (max-width:720px){.cmp-wrap th[scope=row],.cmp-wrap thead th:first-child{min-width:96px;max-width:108px}}
.cmp-wrap a{color:var(--link)}
.cmp-wrap .ours{display:block;font-weight:400;color:var(--muted);font-size:12px}
.cmp-hint{color:var(--muted);font-size:14px;margin:0 0 20px}
.cmp-src{font-size:14px;color:var(--muted);padding-left:20px}
.cmp-src li{font-size:14px;margin:2px 0}
.cmp-end{display:flex;flex-wrap:wrap;gap:10px;margin-top:40px}
.cmp-end .btn.alt{margin-left:0}
</style>
`;

function loadPages(root) {
  const dir = join(root, "content/compare");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

function kitLink(esc, kit) {
  // Our own row links to the code preview (counted as preview_click); others go to their own site.
  if (kit.ours) return `<a href="/inside/">${esc(kit.name)}</a><span class="ours">(ours)</span>`;
  return `<a href="${esc(kit.url)}" rel="nofollow noopener">${esc(kit.name)}</a>`;
}

function renderCompare({ page, esc, SITE, data }) {
  const url = `${SITE}/${data.slug}/`;
  const checked = fmtDay(data.checked);
  const byId = Object.fromEntries(data.kits.map((k) => [k.id, k]));

  const head = `<tr><th scope="col">Kit</th>${data.columns.map((c) => `<th scope="col">${esc(c.label)}</th>`).join("")}</tr>`;
  const rows = data.kits
    .map(
      (k) =>
        `<tr><th scope="row">${kitLink(esc, k)}</th>${data.columns
          .map((c) => `<td>${esc(k.cells[c.key]?.text ?? "Not mentioned on their page.")}</td>`)
          .join("")}</tr>`,
    )
    .join("\n");

  const sources = data.kits
    .map((k) => {
      const links = k.sources
        .map((s) => {
          const ext = /^https?:/.test(s.url) && !s.url.startsWith(SITE);
          return `<a href="${esc(s.url)}"${ext ? ' rel="nofollow noopener"' : ""}>${esc(s.url.replace(/^https?:\/\//, ""))}</a> (${esc(s.what)})`;
        })
        .join("; ");
      const when = k.ours ? `the kit's source, version ${esc(data.kitVersion)}` : `checked ${checked}`;
      return `<li><strong>${esc(k.name)}</strong>: ${links}, ${when}.</li>`;
    })
    .join("\n");

  const picks = data.pickIf
    .map((p) => `<p><strong>${esc(byId[p.id]?.name ?? p.id)}.</strong> ${esc(p.text)}</p>`)
    .join("\n");

  const weaker = data.weaker.map((w) => `<li>${esc(w)}</li>`).join("\n");

  const different = data.different
    .map((d) => {
      const where = d.files.length
        ? `<p class="meta" style="margin:0 0 6px">${d.files.map((f) => `<code>${esc(f)}</code>`).join(" · ")}</p>`
        : d.link
          ? `<p class="meta" style="margin:0 0 6px">Terms: <a href="${esc(d.link)}">${esc(d.link)}</a></p>`
          : "";
      return `<h3>${esc(d.title)}</h3>\n${where}\n<p>${esc(d.text)}</p>`;
    })
    .join("\n");

  const checks = data.checks.map((c) => `<li><strong>${esc(c.title)}</strong> ${esc(c.text)}</li>`).join("\n");

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: data.title,
    description: data.description,
    url,
    datePublished: data.published ?? data.checked,
    dateModified: data.checked,
    inLanguage: "en",
    publisher: { "@type": "Organization", name: "Agentwright", url: SITE },
  };
  const meta = `${STYLE}<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>\n`;

  const others = data.kits.filter((k) => !k.ours).map((k) => k.name);

  const body = `<article>
<h1>${esc(data.title)}</h1>
<div class="cmp-note"><p><strong>Disclosure.</strong> We make Agentwright Starter, so read this as a vendor's comparison. Every fact about another product comes from that product's own public page, linked, as checked on ${esc(checked)}. Prices and features change; check the linked page before you decide.</p></div>
<p class="lede">You are building a product where a Claude agent does the work and your customers pay for it. This page puts ${data.kits.length} starter kits side by side on the things that matter for that: what you pay, whether you can get your money back, what the kit does with LLMs, whether it meters usage per user, which billing providers it supports, and whether it has teams.</p>
<p>The kits: Agentwright Starter, ${esc(others.join(", "))}. Most are Next.js kits. StartKit.AI (Node.js) and Open SaaS (Wasp) are not, but buyers compare them for the same job. There is no ranking and no score: the right kit depends on what you are building.</p>
<p>${esc(data.howChecked)}</p>

<h2 id="table">The kits side by side</h2>
<div class="cmp-wrap" role="region" aria-label="Comparison table" tabindex="0">
<table>
<thead>${head}</thead>
<tbody>
${rows}
</tbody>
</table>
</div>
<p class="cmp-hint">On a phone, scroll the table sideways.</p>
<p>Sources:</p>
<ul class="cmp-src">
${sources}
</ul>

<h2 id="pick">Pick a kit if…</h2>
${picks}

<h2 id="weaker">Where Agentwright Starter is weaker</h2>
<ul>
${weaker}
</ul>

<h2 id="different">Where it is different</h2>
<p>Each point names the file in the kit where you can check it. Three of these files are shown in full on <a href="/inside/">What's inside</a>.</p>
${different}

<h2 id="check">How to check any kit in 30 minutes</h2>
<p>These checks work on any kit, including ours. Most need the code, a code preview or the docs.</p>
<ol>
${checks}
</ol>

<p class="meta">Checked on ${esc(checked)}. We re-check every ${esc(data.recheckEvery)}. If a fact about your product is wrong or out of date, email <a href="mailto:hello@agentwright.app">hello@agentwright.app</a> and we will fix it.</p>
<div class="cmp-end"><a class="btn" href="/inside/">Read the code</a><a class="btn alt" href="/#pricing">Price, refund and license</a></div>
</article>`;

  return { url, html: page({ title: data.metaTitle ?? data.title, description: data.description, url, body, meta }) };
}

export function buildComparePages({ page, esc, SITE, OUT, root }) {
  const urls = [];
  for (const data of loadPages(root)) {
    const { url, html } = renderCompare({ page, esc, SITE, data });
    mkdirSync(join(OUT, data.slug), { recursive: true });
    writeFileSync(join(OUT, data.slug, "index.html"), html);
    urls.push(url);
  }
  return urls;
}

/** Check date of each compare page, by URL, for the sitemap's lastmod. */
export function compareLastmod({ SITE, root }) {
  return Object.fromEntries(loadPages(root).map((d) => [`${SITE}/${d.slug}/`, d.checked]));
}
