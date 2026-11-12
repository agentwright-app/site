// Long-form pages about the kit, written in Markdown: content/guides/<file>.md becomes /<slug>/.
// Called from build-blog.mjs:
//   const guideUrls = buildGuidePages({ page, esc, SITE, OUT, root, pricing, buyUrl: BUY_URL });
//   const guideUpdated = guideLastmod({ SITE, root }); // sitemap lastmod = each page's `updated`
//
// Frontmatter: slug, title, description, updated (YYYY-MM-DD), optional metaTitle.
// {{tokens}} in the body are filled from data that already has one owner, so a guide cannot
// drift from the rest of the site:
//   {{kit_version}} {{code_files}} {{code_lines}} {{tests}}   content/kit/meta.json
//   {{models_table}}   the kit's price rows (meta.json "models") with prices from pricing.json
//   {{weaker_list}}    the "weaker" list of content/compare/ai-saas-boilerplates.json
//   {{buy_box}}        price, refund and the buy button
// An unknown token fails the build.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const n = (x) => x.toLocaleString("en-US");
// $8, $0.10, $2.50: whole dollars as they are, cents always with two digits.
const usd = (x) => (Number.isInteger(x) ? `$${x}` : `$${x.toFixed(2)}`);
const fmtDay = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
// "claude-fable-5-1" -> "Claude Fable 5.1", for a kit model that pricing.json no longer lists.
const modelName = (id) =>
  id.replace(/^claude-([a-z]+)-(\d+)-(\d+)$/, (_, name, a, b) => `Claude ${name[0].toUpperCase()}${name.slice(1)} ${a}.${b}`);

const STYLE = `<style>
.gd-note{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:10px;background:var(--card);padding:14px 16px;margin:20px 0;font-size:16px}
.gd-note p{margin:0}
.gd-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:16px 0;border:1px solid var(--line);border-radius:12px;max-width:100%}
.gd-wrap table{display:table;margin:0;min-width:700px;font-size:15px;line-height:1.5;width:100%}
.gd-wrap th,.gd-wrap td{white-space:normal;vertical-align:top}
.gd-wrap thead th{background:var(--bg)}
.gd-wrap code{white-space:nowrap}
</style>
`;

function parse(src, file) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const val = line.slice(i + 1).trim();
    meta[line.slice(0, i).trim()] = /^".*"$/.test(val) ? val.slice(1, -1) : val;
  }
  for (const k of ["slug", "title", "description", "updated"]) if (!meta[k]) throw new Error(`${file}: frontmatter needs ${k}`);
  if (!/^[a-z0-9-]+$/.test(meta.slug)) throw new Error(`${file}: slug must be one lowercase path segment`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.updated)) throw new Error(`${file}: updated must be YYYY-MM-DD`);
  return { meta, body: m[2] };
}

function loadGuides(root) {
  const dir = join(root, "content/guides");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parse(readFileSync(join(dir, f), "utf8"), `content/guides/${f}`));
}

/** The HTML for each {{token}}. Exported for the tests. */
export function guideTokens({ esc, root, pricing, buyUrl }) {
  const kit = JSON.parse(readFileSync(join(root, "content/kit/meta.json"), "utf8"));
  const compare = JSON.parse(readFileSync(join(root, "content/compare/ai-saas-boilerplates.json"), "utf8"));
  const kitModels = kit.models ?? [];
  const priced = pricing.models.filter((m) => kitModels.includes(m.id));
  const unlisted = kitModels.filter((id) => !pricing.models.some((m) => m.id === id));
  const rows = priced
    .map((m) => `<tr><td><a href="/pricing/claude/${esc(m.id)}/">${esc(m.name)}</a></td><td><code>${esc(m.id)}</code></td><td>${usd(m.input)}</td><td>${usd(m.output)}</td></tr>`)
    .join("\n");
  const long = priced
    .filter((m) => m.longPrompt)
    .map((m) => ` ${esc(m.name)} has a second price row for prompts over ${n(m.longPrompt.thresholdTokens)} tokens (${usd(m.longPrompt.input)} input, ${usd(m.longPrompt.output)} output).`)
    .join("");
  const extra = unlisted.length ? ` The kit also has a price row for ${unlisted.map((id) => esc(modelName(id))).join(" and ")}.` : "";
  return {
    kit_version: esc(kit.version),
    code_files: n(kit.counts.codeFiles),
    code_lines: n(kit.counts.codeLines),
    tests: n(kit.counts.tests),
    models_table: `<table>
<thead><tr><th scope="col">Model</th><th scope="col">Model id</th><th scope="col">Input, per million tokens</th><th scope="col">Output, per million tokens</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>

<p class="meta">Prices in USD, checked against the <a href="${esc(pricing.source)}" rel="nofollow noopener">official Claude pricing page</a> on ${esc(fmtDay(pricing.updated))}.${long}${extra}</p>`,
    weaker_list: `<ul>\n${compare.weaker.map((w) => `<li>${esc(w)}</li>`).join("\n")}\n</ul>`,
    buy_box: `<div class="cta"><p><strong>Agentwright Starter</strong> is $99 at the launch price for the first 50 licenses (list $149; the code LAUNCH is applied at checkout). You pay once and every future version is included. 14-day refund, no questions asked.</p><a class="btn" href="${esc(buyUrl)}">Buy now — $99</a> <a class="btn alt" href="/inside/">Read the code first</a></div>`,
  };
}

function render({ page, esc, SITE, guide, tokens }) {
  const { meta, body } = guide;
  const url = `${SITE}/${meta.slug}/`;
  const filled = body.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => {
    if (!(key in tokens)) throw new Error(`content/guides (${meta.slug}): unknown token {{${key}}}`);
    return tokens[key];
  });
  // A table is wide on a phone: let it scroll inside its own box, like the other tables on the site.
  const html = marked
    .parse(filled)
    .replace(/<table>/g, '<div class="gd-wrap" role="region" aria-label="Table" tabindex="0"><table>')
    .replace(/<\/table>/g, "</table></div>");
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: meta.title,
    description: meta.description,
    url,
    dateModified: meta.updated,
    inLanguage: "en",
    publisher: { "@type": "Organization", name: "Agentwright", url: SITE },
  };
  const head = `${STYLE}<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>\n`;
  const pageBody = `<article>
<h1>${esc(meta.title)}</h1>
${html}
<p class="meta">Updated on ${fmtDay(meta.updated)}, for version ${tokens.kit_version} of the kit. Something wrong or unclear? Email <a href="mailto:hello@agentwright.app">hello@agentwright.app</a>.</p>
</article>`;
  return { url, html: page({ title: meta.metaTitle ?? meta.title, description: meta.description, url, body: pageBody, meta: head }) };
}

export function buildGuidePages({ page, esc, SITE, OUT, root, pricing, buyUrl }) {
  const guides = loadGuides(root);
  if (!guides.length) return [];
  const tokens = guideTokens({ esc, root, pricing, buyUrl });
  const urls = [];
  for (const guide of guides) {
    const { url, html } = render({ page, esc, SITE, guide, tokens });
    mkdirSync(join(OUT, guide.meta.slug), { recursive: true });
    writeFileSync(join(OUT, guide.meta.slug, "index.html"), html);
    urls.push(url);
  }
  return urls;
}

/** `updated` of each guide, by URL, for the sitemap's lastmod. */
export function guideLastmod({ SITE, root }) {
  return Object.fromEntries(loadGuides(root).map((g) => [`${SITE}/${g.meta.slug}/`, g.meta.updated]));
}
