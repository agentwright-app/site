// Pages that show what a buyer gets, built from content/kit/ (filled by scripts/sync-kit-preview.mjs):
//   /inside/            every file with a one-line note, three source files in full, tests + CI
//   /docs/, /docs/<n>/  the docs that ship with the Starter
//   /changelog/         the Starter's changelog
// Returns the URLs for the sitemap.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import { hl } from "./highlight.mjs";
import { BUY_URL as BUY, KIT_TERMS } from "./kit-box.mjs";

// Why each previewed file is worth reading. Keep these true to the code.
const PREVIEW_NOTES = {
  "lib/agent/loop.ts": {
    title: "The agent loop",
    intro:
      "The whole loop is about 100 lines. It streams text, runs every tool call of a turn in parallel and returns the results in one message, stops after 12 turns, treats a refusal as its own error, and checks the user's plan cap before each model call. Metering is imported only when a user id is passed, so evals and smoke tests run without a database.",
  },
  "lib/billing/metering.ts": {
    title: "Per-user metering with price snapshots",
    intro:
      "Every API response becomes one row: raw token counts, the cost in integer micro-dollars, and the id of the price row that produced it. Monthly totals are sums of stored costs, so they never move when model prices change. A model without a price row fails before the API call, so no request is made that could not be recorded.",
  },
  "evals/cases.ts": {
    title: "Eval cases",
    intro:
      "Golden cases run through the real agent loop with the same system prompt and tools. Checks are deliberately simple: which tools must be called, which must not, what the answer has to contain, and an upper bound on turns. The runner prints cost per case and exits non-zero on failure.",
  },
};

const DOC_TITLES = {
  "setup.md": ["setup", "Setup", "Postgres, the Anthropic key, GitHub sign-in, billing, MCP servers and evals: the steps from zip to a running app."],
  "deploy.md": ["deploy", "Deploy on Vercel and Neon", "The zero-ops path: Neon for Postgres, Vercel for the app, the webhook, a post-deploy checklist and notes for other hosts."],
  "pricing.md": ["price-snapshots", "Model prices and price snapshots", "How every usage row stores its cost and the price version used, and how to add a price change without rewriting history."],
  "licensing.md": ["license-delivery", "License key delivery", "If you sell a digital product yourself: issuing license keys on purchase, signed download links, and the admin page."],
  "polar.md": ["polar", "Billing with Polar", "Polar as the billing provider: setup, what each webhook event does to a user's plan, the customer portal, failed payments, limits, and what is and is not tested."],
};

const n = (x) => x.toLocaleString("en-US");

export function loadKit(root) {
  const dir = join(root, "content/kit");
  if (!existsSync(join(dir, "meta.json"))) return null;
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  // layout.txt: "<path(s)><2+ spaces><note>" per line.
  const layout = readFileSync(join(dir, "layout.txt"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      // Two or more spaces separate path and note; a single space is accepted when the README line is not aligned.
      const m = l.match(/^(.*?)\s{2,}(.*)$/) ?? l.match(/^(\S+)\s+(.*)$/);
      return m ? { path: m[1].trim(), note: m[2].trim() } : { path: l.trim(), note: "" };
    });
  return { dir, meta, layout };
}

// /inside/: the offer right after the three files, for people who have just read the code.
// Same facts as the pricing card on the landing page; no deadline, no counters.
export function offerBlock(version) {
  return `<section class="kitbox offer" id="buy" aria-label="Buy Agentwright Starter">
<h2>Get Agentwright Starter</h2>
<p><b style="font-size:26px;letter-spacing:-.02em">$99</b> <s style="color:var(--muted)">$149</s> launch price for the first 50 licenses. The code LAUNCH is applied for you at checkout.</p>
<ul>
<li>Full source code, version ${version}, and lifetime updates: every future version is included</li>
<li>One-time payment, no subscription; unlimited projects, including commercial SaaS</li>
<li>Zip download and license key by email right after payment</li>
<li><b>14-day refund, no questions asked:</b> email your order number within 14 days and you get all of it back</li>
</ul>
<div class="kitbox-btns"><a class="kb-btn" href="${BUY}">Buy — $99</a><a class="kb-btn kb-alt" href="/legal/">Refund policy &amp; license</a></div>
<p class="kitbox-terms" style="margin:12px 0 0">Payment, tax and invoices are handled by Polar, our merchant of record.</p>
</section>`;
}

export function buyBox(esc, note = "") {
  return `<div class="cta"><p><strong>Agentwright Starter</strong> is $99 at the launch price (list $149), paid once, with a 14-day no-questions refund.${note ? " " + esc(note) : ""}</p><a class="btn" href="${BUY}">Buy now — $99</a> <a class="btn alt" href="/#pricing">See pricing</a></div>`;
}

const modelName = (id) =>
  id.replace(/^claude-/, "").replace(/^([a-z]+)-(\d+)-(\d+)$/, (_, n, a, b) => `${n[0].toUpperCase()}${n.slice(1)} ${a}.${b}`);
const fmtDay = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** Releases parsed from the kit's CHANGELOG.md: [{ version, date, points: [inline markdown] }], newest first. */
export function releases(dir) {
  const md = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
  return md
    .split(/^## \[/m)
    .slice(1)
    .map((chunk) => {
      const head = chunk.match(/^([0-9.]+)\]\s*[—-]\s*(\d{4}-\d{2}-\d{2})/);
      if (!head) return null;
      // One short point per bullet: its bold lead if it has one, otherwise its first sentence.
      // Bullets that open with a bold lead are the release's headlines, so they come first.
      const all = [...chunk.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
      const headline = (b) => /^\*\*.+?\*\*/.test(b);
      const bullets = [...all.filter(headline), ...all.filter((b) => !headline(b))];
      const paras = bullets.length ? bullets : [chunk.split("\n").slice(1).join(" ").trim()];
      const points = paras.map((b) => {
        const bold = b.match(/^\*\*(.+?)\*\*/);
        const text = bold ? bold[1] : b.split(/(?<=[.!?])\s/)[0];
        return text.replace(/[.:]$/, "");
      });
      return { version: head[1], date: head[2], points };
    })
    .filter(Boolean);
}

/**
 * The landing page (index.html) is a template: {{TOKENS}} are filled from content/kit/ so the
 * version, line counts, changelog and code excerpt always match the release that is on sale.
 */
export function renderLanding({ template, root, esc, SITE, HL_CSS }) {
  const kit = loadKit(root);
  if (!kit) throw new Error("content/kit/ is missing: run node scripts/sync-kit-preview.mjs <starter checkout>");
  const { dir, meta } = kit;
  const c = meta.counts;
  const rel = releases(dir);
  const metering = readFileSync(join(dir, "files/lib/billing/metering.ts"), "utf8");
  const excerpt = (metering.match(/\/\*\*\n \* Records one API response[\s\S]*?\n}\n/) ?? [""])[0].trimEnd();
  if (!excerpt) throw new Error("recordUsage excerpt not found in content/kit/files/lib/billing/metering.ts");

  const latest = rel
    .slice(0, 4)
    .map(
      (r) =>
        `<li><b>${esc(r.version)}</b><time datetime="${r.date}">${fmtDay(r.date)}</time>${r.points
          .slice(0, 3)
          .map((p) => marked.parseInline(p))
          .join("; ")}${r.points.length > 3 ? `; and ${r.points.length - 3} more` : ""}.</li>`,
    )
    .join("\n");

  const long = new Set(meta.longContextModels ?? []);
  const models = (meta.models ?? []).map((m) => `Claude ${modelName(m)}${long.has(m) ? " (with its long-context price)" : ""}`);
  const modelList = models.length > 1 ? `${models.slice(0, -1).join(", ")} and ${models.at(-1)}` : models.join("");

  let shots = "";
  let heroDemo = "";
  const shotsFile = join(root, "public/shots/shots.json");
  if (existsSync(shotsFile)) {
    // { "version": "0.4.2", "items": [...] }, written by the capture script. The version is the one that was photographed.
    const shotsData = JSON.parse(readFileSync(shotsFile, "utf8"));
    // The demo video plays in the hero (HERO_DEMO), so the screenshots section shows only the stills.
    const video = shotsData.items.find((s) => s.video);
    if (video) {
      heroDemo = `<figure class="demo"><video autoplay muted loop playsinline preload="auto" poster="/shots/${esc(video.poster)}" width="${esc(video.width)}" height="${esc(video.height)}" aria-label="${esc(video.caption)}"><source src="/shots/${esc(video.video)}" type="video/mp4"></video><figcaption>${esc(video.caption)}</figcaption></figure>`;
    }
    const stills = shotsData.items.filter((s) => !s.video);
    // Two columns: a lone half-width still at the end would leave an empty cell, so it spans the row.
    const halves = stills.filter((s) => !s.wide);
    if (halves.length % 2 === 1) halves.at(-1).wide = true;
    const figs = stills
      .map((s) =>
        s.video
          ? `<figure${s.wide ? ' class="wide"' : ""}><video controls muted playsinline preload="none" poster="/shots/${esc(s.poster)}" width="${esc(s.width)}" height="${esc(s.height)}"><source src="/shots/${esc(s.video)}" type="video/mp4"></video><figcaption>${esc(s.caption)}</figcaption></figure>`
          : `<figure${s.wide ? ' class="wide"' : ""}><a href="/shots/${esc(s.link ?? s.file)}"><img src="/shots/${esc(s.file)}" alt="${esc(s.alt)}" width="${esc(s.width)}" height="${esc(s.height)}" loading="lazy" decoding="async"></a><figcaption>${esc(s.caption)}</figcaption></figure>`,
      )
      .join("\n");
    shots = `<section class="block" id="app">
<h2>The app you get on day one</h2>
<p class="lead">Version ${esc(shotsData.version)} running locally, exactly as it ships. The UI is plain on purpose: Tailwind, ready for your own design.</p>
<div class="shots">
${figs}
</div>
</section>`;
  }

  // Sold worldwide; Google's markup takes a country list (up to 50), so these are the main buyer countries.
  const MARKETS = ["US", "GB", "CA", "AU", "DE", "FR", "NL", "ES", "IT", "SE", "IN", "JP", "KR", "SG", "BR"];
  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${SITE}/#org`, name: "Agentwright", url: `${SITE}/`, logo: `${SITE}/icon-512.png`, email: "hello@agentwright.app" },
      { "@type": "WebSite", "@id": `${SITE}/#website`, name: "Agentwright", url: `${SITE}/`, publisher: { "@id": `${SITE}/#org` } },
      {
        "@type": ["Product", "SoftwareApplication"],
        "@id": `${SITE}/#product`,
        name: "Agentwright Starter",
        description:
          "Next.js 16 + TypeScript starter kit (source code) for Claude-powered agent SaaS: streaming agent loop with tools, MCP connectors, per-user token metering with price snapshots, plan caps, rate limiting, sign-in, billing through Lemon Squeezy or Polar and an eval runner.",
        url: `${SITE}/`,
        image: `${SITE}/og.png?v=3`,
        brand: { "@type": "Brand", name: "Agentwright" },
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Any (Node.js)",
        softwareVersion: meta.version,
        // The launch price: $99 through the auto-applied code LAUNCH for the first 50 licenses; list price $149.
        offers: {
          "@type": "Offer", url: `${SITE}/#pricing`, price: "99.00", priceCurrency: "USD", availability: "https://schema.org/InStock", seller: { "@id": `${SITE}/#org` },
          // The published refund policy (/legal/): 14 days, no questions, full refund, nothing to send back.
          hasMerchantReturnPolicy: {
            "@type": "MerchantReturnPolicy",
            applicableCountry: MARKETS,
            returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
            merchantReturnDays: 14,
            returnFees: "https://schema.org/FreeReturn",
            refundType: "https://schema.org/FullRefund",
            merchantReturnLink: `${SITE}/legal/`,
          },
          // A digital download: the zip and license key arrive by email right after payment, free, in every country.
          shippingDetails: {
            "@type": "OfferShippingDetails",
            shippingRate: { "@type": "MonetaryAmount", value: 0, currency: "USD" },
            shippingDestination: MARKETS.map((c) => ({ "@type": "DefinedRegion", addressCountry: c })),
            deliveryTime: {
              "@type": "ShippingDeliveryTime",
              handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 0, unitCode: "DAY" },
              transitTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 0, unitCode: "DAY" },
            },
          },
        },
      },
    ],
  };

  const tokens = {
    KIT_VERSION: esc(meta.version),
    KIT_RELEASED: rel[0] ? fmtDay(rel[0].date) : "",
    KIT_CODE_LINES: n(c.codeLines),
    KIT_CODE_FILES: String(c.codeFiles),
    KIT_TESTS: String(c.tests),
    KIT_RELEASES: String(rel.length),
    KIT_MODELS: esc(modelList),
    CHANGELOG_LATEST: latest,
    CODE_EXCERPT: hl(excerpt, "ts"),
    SHOTS: shots,
    HERO_DEMO: heroDemo,
    HL_CSS,
    PRODUCT_JSONLD: JSON.stringify(jsonld).replace(/</g, "\\u003c"),
  };
  const html = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in tokens)) throw new Error(`index.html: unknown token ${m}`);
    return tokens[k];
  });
  return html;
}

export function buildKitPages({ page, esc, SITE, OUT, root }) {
  const kit = loadKit(root);
  if (!kit) return [];
  const { dir, meta, layout } = kit;
  const c = meta.counts;
  const urls = [];
  const write = (path, html) => {
    mkdirSync(join(OUT, path), { recursive: true });
    writeFileSync(join(OUT, path, "index.html"), html);
    urls.push(`${SITE}/${path}/`);
  };

  // ---- /inside/ ----
  // Real terminal output of the released version (content/kit-runs/, written when the screenshots are retaken).
  // runs.json: { "version": "0.4.2", "date": "2026-11-11" }. Shown only when it matches the synced version.
  const runsDir = join(root, "content/kit-runs");
  let runs = "";
  if (existsSync(join(runsDir, "runs.json"))) {
    const info = JSON.parse(readFileSync(join(runsDir, "runs.json"), "utf8"));
    if (info.version === meta.version) {
      const out = (f) => esc(readFileSync(join(runsDir, f), "utf8").replace(/\n+$/, ""));
      runs = `<p>Both commands, run on version ${esc(info.version)} on ${fmtDay(info.date)}. This is the terminal output:</p>
<pre><code>$ npm test\n${out("test.txt")}</code></pre>
<pre><code>$ npm run eval -- --model claude-haiku-5-5\n${out("eval.txt")}</code></pre>`;
    }
  }
  const fileRows = layout
    .map((f) => `<tr><td><code>${esc(f.path)}</code></td><td>${esc(f.note).replace(/`([^`]+)`/g, "<code>$1</code>")}</td></tr>`)
    .join("\n");
  // The table above is the README's file map (folders grouped). This is the literal list: every tracked file.
  const allFiles = meta.files
    .map((f) => `<tr><td><code>${esc(f.path)}</code></td><td>${n(f.lines)}</td></tr>`)
    .join("\n");
  const previews = meta.previewFiles
    .map((p) => {
      const note = PREVIEW_NOTES[p] ?? { title: p, intro: "" };
      const code = readFileSync(join(dir, "files", p), "utf8").replace(/\n+$/, "");
      const id = p.replace(/[^a-z0-9]+/gi, "-");
      return `<h3 id="${id}">${esc(note.title)}: <code>${esc(p)}</code></h3>
<p>${esc(note.intro)}</p>
<pre class="file"><code class="language-ts">${hl(code, "ts")}</code></pre>`;
    })
    .join("\n");
  const docLinks = meta.docs
    .map((d) => {
      const [slug, title, desc] = DOC_TITLES[d] ?? [d.replace(/\.md$/, ""), d, ""];
      return `<li><a href="/docs/${slug}/">${esc(title)}</a>: ${esc(desc)}</li>`;
    })
    .join("\n");
  const deps = Object.entries(meta.dependencies)
    .map(([k, v]) => `<code>${esc(k)}</code> ${esc(String(v).replace(/^\^/, ""))}`)
    .join(" · ");

  write(
    "inside",
    page({
      title: "What's inside Agentwright Starter: every file, and three in full",
      description: `Read the code before you buy. Agentwright Starter ${meta.version} is ${c.codeFiles} TypeScript files and ${n(c.codeLines)} lines: the file list, the agent loop, metering and eval cases in full, tests, CI and docs.`,
      url: `${SITE}/inside/`,
      body: `<article>
<h1>What's inside</h1>
<p class="lede">Read the code before you buy. This page lists every file in Agentwright Starter ${esc(meta.version)} and shows three of them in full, exactly as they ship.</p>
<p class="kit-pointer">This is the code of <strong>Agentwright Starter</strong>: ${KIT_TERMS}. <a href="#buy">Price and terms</a> · <a href="${BUY}">Buy — $99</a></p>
<p><strong>${c.codeFiles} TypeScript files, ${n(c.codeLines)} lines, ${c.tests} tests, ${c.migrations} database migrations.</strong> It is small on purpose: you can read all of it in an afternoon, and after that it is your code. There is no framework of ours to learn and no package of ours to keep installing.</p>
<p>On this page: <a href="#files">every file</a> · <a href="#code">three files in full</a> · <a href="#tests">tests and CI</a> · <a href="#docs">docs</a> · <a href="#not">what is not included</a></p>

<h2 id="files">Every file</h2>
<table class="files"><thead><tr><th>File</th><th>What it does</th></tr></thead><tbody>
${fileRows}
</tbody></table>
<details><summary>All ${meta.files.length} files with line counts</summary>
<table class="files counts"><thead><tr><th>File</th><th>Lines</th></tr></thead><tbody>
${allFiles}
</tbody></table>
<p class="meta">Left out of this list: <code>package-lock.json</code> and the generated migration snapshots in <code>drizzle/meta/</code>.</p>
</details>
<p>Dependencies (${Object.keys(meta.dependencies).length}), at the versions in the lockfile: ${deps}.</p>

<h2 id="code">Three files in full</h2>
<p>These are the unmodified files from version ${esc(meta.version)}. They are the parts people most often get wrong when they write this themselves.</p>
${previews}
${offerBlock(esc(meta.version))}

<h2 id="tests">Tests and CI</h2>
<p><code>npm test</code> runs ${c.tests} tests in ${c.testFiles} files: price selection and cost math, the tool registry (including the regression test for the 4-cache-breakpoint limit), the Polar adapter (signature check, payloads and API calls), and metering and Polar billing events against a real Postgres database. The GitHub Actions workflow that ships with the kit runs the type check, the tests with a Postgres service, and <code>next build</code> on every pull request:</p>
<pre><code class="language-yaml">${hl(readFileSync(join(dir, "ci.yml"), "utf8").replace(/\n+$/, ""), "yaml")}</code></pre>
<p><code>npm run eval</code> is separate, because it calls the Claude API and costs money: three golden cases on Claude Haiku 5.5 cost well under one cent per run.</p>
${runs}

<h2 id="docs">Docs that ship with it</h2>
<ul>
${docLinks}
<li><a href="/changelog/">Changelog</a>: every release since 0.1.0, with what changed and why.</li>
</ul>

<h2 id="not">What is not included</h2>
<p>So you can decide quickly whether it fits:</p>
<ul>
<li><strong>Organizations, teams and seats.</strong> Accounts are single users. If you sell to companies that need invites and roles, you build that part.</li>
<li><strong>Other payment providers.</strong> Lemon Squeezy and Polar are wired in. Stripe or Paddle means writing a webhook route and checkout calls for it; metering and plan caps do not depend on the provider.</li>
<li><strong>A marketing site or component library.</strong> The UI is deliberately plain: sign-in, chat, usage dashboard, pricing and an admin page, styled with Tailwind. You bring your own design.</li>
<li><strong>Other model providers.</strong> It is built on the Anthropic SDK and Claude's features (prompt caching, tool use, stop reasons). It is not a multi-provider abstraction.</li>
<li><strong>A hosted service.</strong> You get source code. You run it on your own Vercel, Neon and Anthropic accounts.</li>
</ul>
</article>
${buyBox(esc, "If it is not what you expected, email us within 14 days and you get your money back.")}`,
    }),
  );

  // ---- /docs/ ----
  const docCards = [];
  for (const d of meta.docs) {
    const [slug, title, desc] = DOC_TITLES[d] ?? [d.replace(/\.md$/, ""), d, ""];
    const md = readFileSync(join(dir, "docs", d), "utf8").replace(/^# .*\n/, "");
    docCards.push(`<li><a class="t" href="/docs/${slug}/">${esc(title)}</a><p>${esc(desc)}</p></li>`);
    write(
      `docs/${slug}`,
      page({
        title: `${title} — Agentwright Starter docs`,
        description: desc,
        url: `${SITE}/docs/${slug}/`,
        body: `<article class="doc-page">
<p class="meta"><a href="/docs/" style="color:inherit;text-decoration:none">← Docs</a></p>
<h1>${esc(title)}</h1>
<p class="meta">Ships with Agentwright Starter ${esc(meta.version)} as <code>docs/${esc(d)}</code>. File paths refer to the Starter's source.</p>
${marked.parse(md)}
</article>
${buyBox(esc)}`,
      }),
    );
  }
  write(
    "docs",
    page({
      title: "Docs — Agentwright Starter",
      description: "The documentation that ships with Agentwright Starter: setup, deploy on Vercel and Neon, price snapshots, license delivery and the changelog.",
      url: `${SITE}/docs/`,
      body: `<h1>Docs</h1><p class="lede">The documentation that ships with Agentwright Starter ${esc(meta.version)}, public so you can check it before you buy.</p><ul class="post-list">${docCards.join("\n")}
<li><a class="t" href="/inside/">What's inside</a><p>Every file with a one-line note, and three source files in full.</p></li>
<li><a class="t" href="/changelog/">Changelog</a><p>Every release since 0.1.0.</p></li>
<li><a class="t" href="/faq/">FAQ</a><p>Price, refunds, license, delivery, stack and updates.</p></li></ul>`,
    }),
  );

  // ---- /changelog/ ----
  const changelog = readFileSync(join(dir, "CHANGELOG.md"), "utf8")
    .replace(/^# .*\n/, "")
    .replace(/## \[Unreleased\]\n+/, "");
  const releases = (changelog.match(/^## \[/gm) ?? []).length;
  write(
    "changelog",
    page({
      title: "Changelog — Agentwright Starter",
      description: `Every release of Agentwright Starter since 0.1.0: ${releases} releases so far, with what changed and why. Current version ${meta.version}.`,
      url: `${SITE}/changelog/`,
      body: `<article>
<h1>Changelog</h1>
<p class="lede">Every release of Agentwright Starter. Current version: ${esc(meta.version)}. License holders get every update at no extra cost.</p>
${marked.parse(changelog)}
</article>
${buyBox(esc)}`,
    }),
  );

  return urls;
}
