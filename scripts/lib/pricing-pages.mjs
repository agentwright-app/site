// Search landing pages for Claude API prices, generated from the cost calculator's pricing.json:
//   /pricing/claude/            all models, one table
//   /pricing/claude/<model-id>/ one page per model (worked examples, caching, batch, FAQ)
// Every number comes from pricing.json, so updating that file + deploy updates these pages too.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCostPages } from "./cost-pages.mjs";

const fmt = (n) => (n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toPrecision(2)}`);
const per = (tokens, rate) => (tokens * rate) / 1e6;
const month = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const EXAMPLES = [
  { name: "Short chat reply", input: 2_000, output: 300 },
  { name: "Agent turn with tools and history", input: 12_000, output: 800 },
  { name: "Summarize a 40-page document", input: 30_000, output: 1_000 },
];

export function buildPricingPages({ page, esc, SITE, OUT, pricing }) {
  const models = pricing.models;
  const asOf = month(pricing.updated);
  const urls = [];
  const footerLinks = `<div class="cta"><p><strong>Run your own numbers.</strong> The free <a href="/tools/claude-api-cost-calculator/">Claude API cost calculator</a> works out cost per request, per user and per month, and the <a href="/tools/claude-pricing-mcp/">Claude Pricing MCP server</a> lets Claude, Cursor or any MCP client answer the same questions inside your editor.</p><p>Building a Claude-powered SaaS? <a href="/">Agentwright Starter</a> records token usage per user and turns it into dollars with this same price table.</p></div>`;
  const src = `<p class="meta">Prices in USD per million tokens, checked against the <a href="${esc(pricing.source)}">official Claude pricing page</a> on ${esc(pricing.updated)}.</p>`;

  // ---------- hub ----------
  const rows = models
    .map(
      (m) =>
        `<tr><td><a href="/pricing/claude/${m.id}/">${esc(m.name)}</a></td><td>$${m.input}</td><td>$${m.output}</td><td>$${m.cacheWrite5m}</td><td>$${m.cacheWrite1h}</td><td>$${m.cacheRead}</td><td>$${+(m.input * pricing.batchDiscount).toFixed(4)} / $${+(m.output * pricing.batchDiscount).toFixed(4)}</td></tr>`,
    )
    .join("");
  const exRows = EXAMPLES.map(
    (e) => `<tr><td>${e.name}<br><small>${e.input.toLocaleString("en-US")} in / ${e.output.toLocaleString("en-US")} out</small></td>${models.map((m) => `<td>${fmt(per(e.input, m.input) + per(e.output, m.output))}</td>`).join("")}</tr>`,
  ).join("");
  const longNotes = models
    .filter((m) => m.longPrompt)
    .map((m) => `<li>${esc(m.name)}: prompts over ${m.longPrompt.thresholdTokens.toLocaleString("en-US")} tokens are billed at $${m.longPrompt.input} input and $${m.longPrompt.output} output per million tokens for the whole request.</li>`)
    .join("");
  const hubFaq = [
    ["How is Claude API usage billed?", "Per token. Input tokens (your prompt, conversation history, tool definitions and documents) and output tokens (the reply, including extended thinking) have separate prices per million tokens. There is no fixed monthly fee for the API itself."],
    ["What is the cheapest Claude model?", `${models.reduce((a, b) => (a.input + a.output <= b.input + b.output ? a : b)).name} at $${models.reduce((a, b) => (a.input + a.output <= b.input + b.output ? a : b)).input} input / $${models.reduce((a, b) => (a.input + a.output <= b.input + b.output ? a : b)).output} output per million tokens.`],
    ["How much does prompt caching save?", "A cache read costs a small fraction of the normal input price, so a long system prompt, tool list or document that repeats across requests becomes much cheaper after the first call. Writing to the cache costs a little more than normal input (more for the 1-hour cache than the 5-minute one)."],
    ["What does the Batch API cost?", `Requests sent through the Message Batches API are billed at ${pricing.batchDiscount * 100}% of the normal price, in exchange for results arriving asynchronously (usually within 24 hours).`],
  ];
  const faqLd = (faq) =>
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}</script>`;
  const faqHtml = (faq) => faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("");

  const extra = buildCostPages({ page, esc, SITE, OUT, pricing, faqLd, faqHtml, footerLinks, src });

  mkdirSync(join(OUT, "pricing/claude"), { recursive: true });
  writeFileSync(
    join(OUT, "pricing/claude/index.html"),
    page({
      title: `Claude API pricing (${asOf}): every model, caching and batch prices`,
      description: `Current Claude API prices per million tokens for ${models.map((m) => m.name.replace("Claude ", "")).join(", ")}: input, output, prompt caching and Batch API, with worked cost examples.`,
      url: `${SITE}/pricing/claude/`,
      meta: faqLd(hubFaq),
      body: `<h1>Claude API pricing</h1>${src}<article>
<p class="lede">What every current Claude model costs through the API, what a typical request costs in practice, and where caching and batching cut the bill.</p>
<h2>Prices per million tokens</h2>
<table><thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cache write 5m</th><th>Cache write 1h</th><th>Cache read</th><th>Batch in / out</th></tr></thead><tbody>${rows}</tbody></table>
${longNotes ? `<ul>${longNotes}</ul>` : ""}
<h2>What a single request costs</h2>
<p>Without caching or batching:</p>
<table><thead><tr><th>Request</th>${models.map((m) => `<th>${esc(m.name.replace("Claude ", ""))}</th>`).join("")}</tr></thead><tbody>${exRows}</tbody></table>
${extra.hubHtml}
<h2>Questions</h2>${faqHtml(hubFaq)}
</article>${footerLinks}`,
    }),
  );
  urls.push(`${SITE}/pricing/claude/`);

  // ---------- one page per model ----------
  for (const m of models) {
    const others = models.filter((o) => o.id !== m.id);
    const ex = EXAMPLES.map((e) => {
      const plain = per(e.input, m.input) + per(e.output, m.output);
      return `<tr><td>${e.name}<br><small>${e.input.toLocaleString("en-US")} in / ${e.output.toLocaleString("en-US")} out</small></td><td>${fmt(plain)}</td><td>${fmt(plain * 1000)}</td><td>${fmt(plain * pricing.batchDiscount)}</td></tr>`;
    }).join("");
    // caching example: 10,000-token reused prefix + 1,000 new tokens, 500 out, 20 calls inside the cache window
    const prefix = 10_000, fresh = 1_000, out = 500, calls = 20;
    const noCache = calls * (per(prefix + fresh, m.input) + per(out, m.output));
    const withCache = per(prefix, m.cacheWrite5m) + (calls - 1) * per(prefix, m.cacheRead) + calls * (per(fresh, m.input) + per(out, m.output));
    const saving = Math.round((1 - withCache / noCache) * 100);
    const compare = others
      .map((o) => {
        const r = (o.input + o.output) / (m.input + m.output);
        const word = r > 1 ? `${+r.toFixed(1)}× the price of ${esc(m.name.replace("Claude ", ""))}` : `${+(1 / r).toFixed(1)}× cheaper than ${esc(m.name.replace("Claude ", ""))}`;
        return `<li><a href="/pricing/claude/${o.id}/">${esc(o.name)}</a>: $${o.input} / $${o.output}, about ${word} for the same tokens.</li>`;
      })
      .join("");
    const faq = [
      [`How much does ${m.name} cost?`, `$${m.input} per million input tokens and $${m.output} per million output tokens. Prompt cache reads cost $${m.cacheRead} per million tokens; cache writes cost $${m.cacheWrite5m} (5-minute) or $${m.cacheWrite1h} (1-hour) per million tokens.`],
      [`What is the ${m.name} model id?`, `Use "${m.id}" as the model parameter in the Messages API.`],
      [`Is there a cheaper way to run ${m.name}?`, `Yes. Batch API requests cost ${pricing.batchDiscount * 100}% of the normal price, and prompt caching cuts the cost of repeated context. In the caching example on this page, 20 calls that share a 10,000-token prefix cost about ${saving}% less with caching.`],
    ];
    if (m.longPrompt) faq.push([`Does ${m.name} cost more for long prompts?`, `Yes. When a prompt is over ${m.longPrompt.thresholdTokens.toLocaleString("en-US")} tokens, the whole request is billed at $${m.longPrompt.input} input and $${m.longPrompt.output} output per million tokens.`]);
    mkdirSync(join(OUT, "pricing/claude", m.id), { recursive: true });
    writeFileSync(
      join(OUT, "pricing/claude", m.id, "index.html"),
      page({
        title: `${m.name} API pricing (${asOf}): $${m.input} / $${m.output} per million tokens`,
        description: `${m.name} costs $${m.input} per million input tokens and $${m.output} per million output tokens. Caching and Batch API prices, worked examples per request and per 1,000 requests, and how it compares with other Claude models.`,
        url: `${SITE}/pricing/claude/${m.id}/`,
        meta: faqLd(faq),
        body: `<p class="meta"><a href="/pricing/claude/">Claude API pricing</a> › ${esc(m.name)}</p><h1>${esc(m.name)} API pricing</h1>${src}<article>
<table><thead><tr><th>Item</th><th>Price per million tokens</th></tr></thead><tbody>
<tr><td>Input</td><td>$${m.input}</td></tr><tr><td>Output (incl. thinking)</td><td>$${m.output}</td></tr>
<tr><td>Cache write, 5 minutes</td><td>$${m.cacheWrite5m}</td></tr><tr><td>Cache write, 1 hour</td><td>$${m.cacheWrite1h}</td></tr>
<tr><td>Cache read</td><td>$${m.cacheRead}</td></tr>
<tr><td>Batch API input / output</td><td>$${+(m.input * pricing.batchDiscount).toFixed(4)} / $${+(m.output * pricing.batchDiscount).toFixed(4)}</td></tr>
${m.longPrompt ? `<tr><td>Prompts over ${m.longPrompt.thresholdTokens.toLocaleString("en-US")} tokens: input / output</td><td>$${m.longPrompt.input} / $${m.longPrompt.output}</td></tr>` : ""}
</tbody></table>
<p>Model id: <code>${m.id}</code></p>
<h2>What it costs in practice</h2>
<table><thead><tr><th>Request</th><th>One request</th><th>1,000 requests</th><th>One request, Batch API</th></tr></thead><tbody>${ex}</tbody></table>
<h2>Prompt caching example</h2>
<p>An agent sends the same 10,000-token system prompt and tool list on every call, plus 1,000 new tokens, and gets 500 tokens back. Over 20 calls inside a 5-minute cache window:</p>
<ul><li>Without caching: <strong>${fmt(noCache)}</strong></li><li>With caching (one cache write, then 19 cache reads): <strong>${fmt(withCache)}</strong>, about ${saving}% less</li></ul>
<h2>Compared with other Claude models</h2><ul>${compare}</ul>
<p>Side-by-side pages with worked examples:</p><ul>${extra.compareLinks(m)}</ul>
<p>Input + output price per million tokens, compared as a simple sum. Your real ratio depends on how many input versus output tokens your workload uses; the <a href="/tools/claude-api-cost-calculator/">calculator</a> compares models on your own numbers.</p>
<p>What a typical app costs on ${esc(m.name)}: ${extra.costLinks}.</p>
<h2>Questions</h2>${faqHtml(faq)}
</article>${footerLinks}`,
      }),
    );
    urls.push(`${SITE}/pricing/claude/${m.id}/`);
  }
  return [...urls, ...extra.urls];
}
