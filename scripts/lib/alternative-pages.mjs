// One-to-one comparison pages, /alternatives/<name>/, and the /alternatives/ index,
// built from content/alternatives/*.json. Called from build-blog.mjs:
//   const altUrls = buildAlternativePages({ page, esc, SITE, OUT, root });
//   const altChecked = alternativeLastmod({ SITE, root }); // sitemap lastmod = each page's `checked`
//
// Rules the data must follow. The build fails when one is broken, so a wrong page cannot ship:
//   - every page names its sources and its check date, and every row says something about the
//     other product (write the page's `notMentioned` sentence when the source is silent);
//   - what we say about our own kit comes from content/compare/ai-saas-boilerplates.json when
//     that file has the fact (`oursKey`), so the two pages cannot disagree;
//   - a linked blog post must exist and be public on the page's `published` date (posts open on
//     their own date; before that the link would be a 404).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const fmtDay = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const n = (x) => x.toLocaleString("en-US");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const STYLE = `<style>
.alt-note{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:10px;background:var(--card);padding:14px 16px;margin:20px 0;font-size:16px}
.alt-note p{margin:0}
.alt-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:16px 0 8px;border:1px solid var(--line);border-radius:12px;max-width:100%}
.alt-wrap table{display:table;margin:0;min-width:660px;font-size:15px;line-height:1.5;table-layout:fixed;width:100%}
.alt-wrap th,.alt-wrap td{white-space:normal;vertical-align:top}
.alt-wrap thead th{background:var(--bg)}
.alt-wrap thead th:first-child{width:22%}
.alt-wrap th[scope=row]{color:var(--ink)}
.alt-wrap a{color:var(--link)}
.alt-hint{color:var(--muted);font-size:14px;margin:0 0 20px}
.alt-src{font-size:14px;color:var(--muted);padding-left:20px}
.alt-src li{font-size:14px;margin:2px 0;overflow-wrap:anywhere}
p.alt-where{margin:0 0 6px}
p.alt-read{margin:6px 0 0;font-size:15px}
.alt-end{display:flex;flex-wrap:wrap;gap:10px;margin-top:40px}
.alt-end .btn.alt{margin-left:0}
.alt-list{list-style:none;padding:0;margin:24px 0}
.alt-list li{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:16px 18px;margin:0 0 12px}
.alt-list a{font-weight:600;font-size:18px}
.alt-list p{margin:6px 0 0;font-size:16px}
.alt-list .meta{margin:6px 0 0}
</style>
`;

/** Escapes text, then turns `code` and [label](/path/ or https://...) into HTML. */
export function rich(esc, SITE, s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((\/[^)\s]*|https:\/\/[^)\s]+)\)/g, (_, label, href) => {
      const ext = href.startsWith("https://") && !href.startsWith(SITE);
      return `<a href="${href}"${ext ? ' rel="nofollow noopener"' : ""}>${label}</a>`;
    });
}

/** What both kinds of comparison page share: our own facts, the weaker list and the kit's numbers. */
export function loadShared(root) {
  const compare = JSON.parse(readFileSync(join(root, "content/compare/ai-saas-boilerplates.json"), "utf8"));
  const ours = compare.kits.find((k) => k.ours);
  if (!ours) throw new Error("content/compare/ai-saas-boilerplates.json: no kit with ours: true");
  const meta = JSON.parse(readFileSync(join(root, "content/kit/meta.json"), "utf8"));
  return { ours, weaker: compare.weaker, kit: meta };
}

function postDate(root, slug) {
  const file = join(root, "content/posts", `${slug}.md`);
  if (!existsSync(file)) return null;
  const head = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  return head.match(/^date:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
}

/** Throws with every problem found in one page's data. Exported for the tests. */
export function validateAlternative(data, { root, shared, file = "content/alternatives/?.json" }) {
  const bad = [];
  const need = (ok, msg) => ok || bad.push(msg);
  const text = (v) => typeof v === "string" && v.trim().length > 0;
  const list = (v) => Array.isArray(v) && v.length > 0;

  need(/^alternatives\/[a-z0-9-]+$/.test(data.slug ?? ""), "slug must look like alternatives/<name>");
  for (const k of ["title", "description", "hubLine", "lede"]) need(text(data[k]), `${k} is missing`);
  for (const k of ["checked", "published"]) need(DAY.test(data[k] ?? ""), `${k} must be YYYY-MM-DD`);
  need(text(data.other?.name) && /^https:\/\//.test(data.other?.url ?? ""), "other.name and other.url (https) are required");
  need(list(data.other?.sources) && data.other.sources.every((s) => /^https:\/\//.test(s.url ?? "") && text(s.what)), "other.sources needs at least one { url (https), what }");
  need(list(data.about) && data.about.every(text), "about needs at least one paragraph");
  need(list(data.stayIf) && data.stayIf.every(text), "stayIf needs at least one point: say when the other product is the better choice");
  need(list(data.pickIf) && data.pickIf.every(text), "pickIf needs at least one point");

  need(list(data.rows), "rows is empty");
  for (const r of data.rows ?? []) {
    const tag = `row "${r.label ?? "?"}"`;
    need(text(r.label), "a row has no label");
    need(text(r.other), `${tag}: \`other\` is empty (write the notMentioned sentence if the source says nothing)`);
    need(text(r.ours) !== text(r.oursKey), `${tag}: give exactly one of \`ours\` and \`oursKey\``);
    if (r.oursKey) need(text(shared.ours.cells[r.oursKey]?.text), `${tag}: oursKey "${r.oursKey}" is not a cell of our kit in content/compare/ai-saas-boilerplates.json`);
  }

  for (const g of data.gaps ?? []) {
    need(text(g.title) && text(g.text), "a gap needs a title and a text");
    for (const p of g.posts ?? []) {
      const slug = (p.href ?? "").match(/^\/blog\/([a-z0-9-]+)\/$/)?.[1];
      if (!slug || !text(p.title)) {
        bad.push(`gap "${g.title}": a post needs { href: "/blog/<slug>/", title }`);
        continue;
      }
      const date = postDate(root, slug);
      if (!date) bad.push(`gap "${g.title}": content/posts/${slug}.md does not exist`);
      else if (DAY.test(data.published ?? "") && date > data.published)
        bad.push(`gap "${g.title}": /blog/${slug}/ opens on ${date}, after this page's published date ${data.published} (the link would be a 404)`);
    }
  }
  for (const q of data.faq ?? []) need(text(q.q) && text(q.a), "an faq item needs q and a");
  for (const r of data.routes ?? []) need(text(r.title) && text(r.text), "a route needs a title and a text");

  if (bad.length) throw new Error(`${file}:\n  - ${bad.join("\n  - ")}`);
  return data;
}

export function loadAlternatives(root) {
  const dir = join(root, "content/alternatives");
  if (!existsSync(dir)) return [];
  const shared = loadShared(root);
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => validateAlternative(JSON.parse(readFileSync(join(dir, f), "utf8")), { root, shared, file: `content/alternatives/${f}` }));
  const slugs = pages.map((p) => p.slug);
  const twice = slugs.find((s, i) => slugs.indexOf(s) !== i);
  if (twice) throw new Error(`content/alternatives: two files use the slug ${twice}`);
  return pages;
}

function renderAlternative({ page, esc, SITE, data, shared, all }) {
  const url = `${SITE}/${data.slug}/`;
  const checked = fmtDay(data.checked);
  const o = data.other;
  const c = shared.kit.counts;
  // Numbers about our kit are filled in from content/kit/meta.json, so they follow each release.
  const fill = (s) =>
    s
      .replaceAll("{checked}", checked)
      .replaceAll("{kitVersion}", shared.kit.version)
      .replaceAll("{codeFiles}", n(c.codeFiles))
      .replaceAll("{codeLines}", n(c.codeLines))
      .replaceAll("{tests}", n(c.tests));
  const R = (s) => rich(esc, SITE, fill(s));
  const list = (items) => items.map((t) => `<li>${R(t)}</li>`).join("\n");

  const rows = data.rows
    .map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${R(r.other)}</td><td>${R(r.oursKey ? shared.ours.cells[r.oursKey].text : r.ours)}</td></tr>`)
    .join("\n");

  const sources = o.sources
    .map((s) => `<li><a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.url.replace(/^https?:\/\//, ""))}</a> (${esc(s.what)}), checked ${checked}.</li>`)
    .join("\n");

  const gaps = (data.gaps ?? [])
    .map((g) => {
      const where = g.files?.length ? `<p class="meta alt-where">In the kit: ${g.files.map((f) => `<code>${esc(f)}</code>`).join(" · ")}</p>` : "";
      const read = g.posts?.length
        ? `<p class="alt-read">The code, explained: ${g.posts.map((p) => `<a href="${esc(p.href)}">${esc(p.title)}</a>`).join(" · ")}</p>`
        : "";
      return `<h3>${esc(g.title)}</h3>\n${where}\n<p>${R(g.text)}</p>\n${read}`;
    })
    .join("\n");

  const routes = (data.routes ?? []).map((r) => `<h3>${esc(r.title)}</h3>\n<p>${R(r.text)}</p>`).join("\n");
  const faq = (data.faq ?? []).map((q) => `<h3>${esc(q.q)}</h3>\n<p>${R(q.a)}</p>`).join("\n");
  const more = all
    .filter((p) => p.slug !== data.slug)
    .map((p) => `<li><a href="/${p.slug}/">${esc(p.title)}</a></li>`)
    .join("\n");

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: data.title,
    description: data.description,
    url,
    datePublished: data.published,
    dateModified: data.checked,
    inLanguage: "en",
    publisher: { "@type": "Organization", name: "Agentwright", url: SITE },
  };
  const meta = `${STYLE}<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>\n`;

  const body = `<article>
<h1>${esc(data.title)}</h1>
<div class="alt-note"><p><strong>Disclosure.</strong> We make Agentwright Starter, so read this as a vendor's comparison. Every fact about ${esc(o.name)} comes from ${esc(o.sourceKind ?? "its own public page")}, linked below, as checked on ${esc(checked)}. Prices and features change; check the source before you decide.</p></div>
<p class="lede">${R(data.lede)}</p>

<h2 id="about">What ${esc(o.name)} is</h2>
${data.about.map((p) => `<p>${R(p)}</p>`).join("\n")}

<h2 id="table">Side by side</h2>
<div class="alt-wrap" role="region" aria-label="Comparison table" tabindex="0">
<table>
<thead><tr><th scope="col"></th><th scope="col"><a href="${esc(o.url)}" rel="nofollow noopener">${esc(o.name)}</a></th><th scope="col"><a href="/inside/">Agentwright Starter</a> (ours)</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
<p class="alt-hint">On a phone, scroll the table sideways. "${esc((o.notMentioned ?? "Not mentioned on their page.").replace(/\.$/, ""))}" means we did not find it in the sources below, not that the product lacks it.</p>
<p>Sources for ${esc(o.name)}:</p>
<ul class="alt-src">
${sources}
</ul>
<p class="alt-hint">Agentwright Starter: the kit's source, version ${esc(shared.kit.version)}. <a href="/inside/">What's inside</a> lists every file, and the <a href="/legal/">refund and license terms</a> are public.</p>
${
  gaps
    ? `
<h2 id="parts">${esc(data.gapsTitle ?? "Where the two differ")}</h2>
${data.gapsIntro ? `<p>${R(data.gapsIntro)}</p>` : ""}
${gaps}
`
    : ""
}${
    routes
      ? `
<h2 id="routes">${esc(data.routesTitle ?? "Two ways to get there")}</h2>
${routes}
`
      : ""
  }
<h2 id="stay">Stay with ${esc(o.name)} if…</h2>
<ul>
${list(data.stayIf)}
</ul>

<h2 id="pick">Pick Agentwright Starter if…</h2>
<ul>
${list(data.pickIf)}
</ul>

<h2 id="weaker">Where Agentwright Starter is weaker</h2>
<p>The same list as on our <a href="/compare/ai-saas-boilerplates/">nine-kit comparison</a>:</p>
<ul>
${shared.weaker.map((w) => `<li>${esc(w)}</li>`).join("\n")}
</ul>
${
  faq
    ? `
<h2 id="questions">Questions</h2>
${faq}
`
    : ""
}
<h2 id="more">More comparisons</h2>
<ul>
${more}
<li><a href="/compare/ai-saas-boilerplates/">Nine starter kits side by side</a></li>
<li><a href="/claude-agent-saas-boilerplate/">What a Claude agent SaaS boilerplate has to cover</a></li>
</ul>

<p class="meta">Checked on ${esc(checked)}. We re-check every ${esc(data.recheckEvery ?? "month")}. If a fact about your product is wrong or out of date, email <a href="mailto:hello@agentwright.app">hello@agentwright.app</a> and we will fix it.</p>
<div class="alt-end"><a class="btn" href="/inside/">Read the code</a><a class="btn alt" href="/#pricing">Price, refund and license</a></div>
</article>`;

  return { url, html: page({ title: data.metaTitle ?? data.title, description: data.description, url, body, meta }) };
}

function renderIndex({ page, esc, SITE, all }) {
  const url = `${SITE}/alternatives/`;
  const title = "Agentwright Starter and the alternatives";
  const description =
    "One-to-one comparisons of Agentwright Starter with other ways to start an AI product. Each page gives the other product's facts from its own page, with sources and a check date, and says when it is the better choice.";
  const items = all
    .map(
      (p) =>
        `<li><a href="/${p.slug}/">${esc(p.title)}</a><p>${esc(p.hubLine)}</p><p class="meta">Checked on ${esc(fmtDay(p.checked))}</p></li>`,
    )
    .join("\n");
  const body = `<article>
<h1>${esc(title)}</h1>
<div class="alt-note"><p><strong>Disclosure.</strong> We make Agentwright Starter, so read these as a vendor's comparisons. Every fact about another product comes from that product's own public page or repository, linked on each page with the date we checked it.</p></div>
<p class="lede">One page per product that people look at for the same job. Each one says what the other product is, puts the two side by side, and says when the other product is the better choice.</p>
<ul class="alt-list">
${items}
</ul>
<h2>More</h2>
<ul>
<li><a href="/compare/ai-saas-boilerplates/">Nine starter kits side by side</a>: price, refund, LLM support, usage metering, billing and teams in one table.</li>
<li><a href="/claude-agent-saas-boilerplate/">What a Claude agent SaaS boilerplate has to cover</a>: the parts beyond login and payments, with the file in the kit that does each.</li>
<li><a href="/inside/">What's inside</a>: every file in Agentwright Starter, and three of them in full.</li>
</ul>
</article>`;
  return { url, html: page({ title: `${title} | Agentwright`, description, url, body, meta: STYLE }) };
}

export function buildAlternativePages({ page, esc, SITE, OUT, root }) {
  const all = loadAlternatives(root);
  if (!all.length) return [];
  const shared = loadShared(root);
  const urls = [];
  for (const data of all) {
    const { url, html } = renderAlternative({ page, esc, SITE, data, shared, all });
    mkdirSync(join(OUT, data.slug), { recursive: true });
    writeFileSync(join(OUT, data.slug, "index.html"), html);
    urls.push(url);
  }
  const index = renderIndex({ page, esc, SITE, all });
  mkdirSync(join(OUT, "alternatives"), { recursive: true });
  writeFileSync(join(OUT, "alternatives", "index.html"), index.html);
  return [index.url, ...urls];
}

/** Check date of each page, by URL, for the sitemap's lastmod (the index takes the latest one). */
export function alternativeLastmod({ SITE, root }) {
  const all = loadAlternatives(root);
  const out = Object.fromEntries(all.map((d) => [`${SITE}/${d.slug}/`, d.checked]));
  if (all.length) out[`${SITE}/alternatives/`] = all.map((d) => d.checked).sort().at(-1);
  return out;
}
