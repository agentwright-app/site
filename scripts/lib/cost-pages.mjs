// More search landing pages built from the same pricing.json as /pricing/claude/:
//   /pricing/claude/compare/<a>-vs-<b>/   one page per model pair ("opus vs sonnet price")
//   /pricing/claude/cost/<use-case>/      what a typical app costs to run ("claude chatbot cost per month")
// The workload numbers below are stated assumptions shown on each page; prices always come from pricing.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const fmt = (n) => (n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toPrecision(2)}`);
const per = (tokens, rate) => (tokens * rate) / 1e6;
const n = (x) => x.toLocaleString("en-US");
const short = (m) => m.name.replace("Claude ", "");
export const pairSlug = (a, b) => `${a.id.replace(/^claude-/, "")}-vs-${b.id.replace(/^claude-/, "")}`;

// Per-model rates for a request with this many input tokens (long-prompt pricing applies to the whole request).
function rates(m, inputTokens) {
  return m.longPrompt && inputTokens > m.longPrompt.thresholdTokens ? { ...m, ...m.longPrompt } : m;
}

// One "unit" of work = `calls` API calls, each with `cached` reused prefix tokens, `fresh` new input tokens and `output` tokens.
// freshIsCached: in a multi-turn conversation the new tokens are written to the cache so the next turn can read them.
export function unitCost(m, u, { caching = false, batch = 1 } = {}) {
  const r = rates(m, u.cached + u.fresh);
  const call = caching
    ? per(u.cached, r.cacheRead) + per(u.fresh, u.freshIsCached ? r.cacheWrite5m : r.input) + per(u.output, r.output)
    : per(u.cached + u.fresh, r.input) + per(u.output, r.output);
  return call * u.calls * batch;
}

export const USE_CASES = [
  {
    slug: "chatbot",
    title: "How much does a Claude chatbot cost to run?",
    short: "Chatbot",
    query: "Claude chatbot cost per month",
    unit: "message", units: "messages",
    calls: 1, cached: 4_000, fresh: 500, output: 400, freshIsCached: true,
    monthly: [{ label: "One active user (300 messages/month)", units: 300 }, { label: "1,000 active users", units: 300_000 }],
    assume: "A system prompt of about 1,500 tokens plus earlier turns of the conversation (about 4,000 tokens on an average turn), then about 500 new tokens (the user's message and the last reply) and a 400-token answer. An active user sends about 300 messages a month.",
    notes: [
      "Conversation history is the cost that grows quietly: every new message re-sends the earlier turns. Caching makes those re-sent turns cheap, and trimming or compacting long conversations keeps them from growing without limit.",
      "Most chat traffic does not need the largest model. Many products use a smaller model by default and switch to a larger one only for hard requests.",
      "Charge or cap per user. A few heavy users can cost more than everyone else combined, so put a monthly dollar limit on each account.",
    ],
  },
  {
    slug: "customer-support-bot",
    title: "How much does a Claude customer support bot cost?",
    short: "Support bot",
    query: "AI customer support bot cost with Claude",
    unit: "ticket", units: "tickets",
    calls: 4, cached: 3_000, fresh: 4_000, output: 350, freshIsCached: false,
    monthly: [{ label: "Small team (500 tickets/month)", units: 500 }, { label: "Busy help desk (10,000 tickets/month)", units: 10_000 }],
    assume: "Each ticket takes 4 replies. Every reply sends a 3,000-token system prompt with tool definitions (cacheable) plus about 4,000 new tokens of retrieved help-center articles, account data and the customer's message, and gets a 350-token answer.",
    notes: [
      "Retrieved documents are usually the biggest part of the bill. Retrieving fewer, better chunks saves more than switching models.",
      "Tool definitions and the system prompt repeat on every reply, so they are the part prompt caching makes cheap.",
      "Compare the cost per ticket with what a ticket costs your team today; that number decides which model you can afford.",
    ],
  },
  {
    slug: "coding-agent",
    title: "How much does a Claude coding agent cost per task?",
    short: "Coding agent",
    query: "Claude coding agent cost per task",
    unit: "task", units: "tasks",
    calls: 25, cached: 30_000, fresh: 3_000, output: 1_500, freshIsCached: true,
    monthly: [{ label: "One developer (100 tasks/month)", units: 100 }, { label: "Team of 20 developers", units: 2_000 }],
    assume: "One task is an agent loop of 25 model calls. On an average call the agent re-sends about 30,000 tokens (instructions, tool list, files it has read and earlier steps), adds about 3,000 new tokens of tool results, and writes 1,500 tokens of reasoning, edits or tool calls.",
    notes: [
      "Agent loops are where caching matters most: almost everything on each call was already sent on the previous call.",
      "Cap the number of steps and the dollars per task. A loop that keeps calling tools is the classic surprise bill.",
      "Large tool results (whole files, long logs) fill the context fast. Return only what the model needs.",
    ],
  },
  {
    slug: "rag-document-qa",
    title: "How much does a Claude RAG app cost per question?",
    short: "Document Q&A (RAG)",
    query: "RAG cost per query with Claude",
    unit: "question", units: "questions",
    calls: 1, cached: 1_500, fresh: 6_000, output: 500, freshIsCached: false,
    monthly: [{ label: "One user (200 questions/month)", units: 200 }, { label: "1,000 users", units: 200_000 }],
    assume: "A 1,500-token system prompt, about 6,000 tokens of retrieved document chunks plus the question, and a 500-token answer with citations.",
    notes: [
      "Cost scales with how much you retrieve. Going from 6,000 to 3,000 retrieved tokens roughly halves the input cost.",
      "Retrieved chunks change with every question, so they are not cached; only the fixed system prompt is.",
      "If many users ask about the same document, put that document in the cached prefix instead of retrieving pieces of it.",
    ],
  },
  {
    slug: "document-summarization",
    title: "How much does it cost to summarize documents with Claude?",
    short: "Document summarization",
    query: "cost to summarize documents with Claude API",
    unit: "document", units: "documents",
    calls: 1, cached: 500, fresh: 30_000, output: 1_000, freshIsCached: false, batch: true,
    monthly: [{ label: "1,000 documents/month", units: 1_000 }, { label: "50,000 documents/month", units: 50_000 }],
    assume: "A 40-page document (about 30,000 tokens) with 500 tokens of instructions, summarized into about 1,000 tokens.",
    notes: [
      "Nothing repeats between documents except the short instructions, so caching barely helps here. The Batch API does: it halves the price when results can wait.",
      "Input tokens dominate. Strip boilerplate, headers and repeated footers before sending.",
      "For very long documents, check whether the model has a higher price above a prompt-length threshold.",
    ],
  },
  {
    slug: "classification-extraction",
    title: "How much does classification or data extraction with Claude cost?",
    short: "Classification & extraction",
    query: "Claude API cost for classification and data extraction",
    unit: "item", units: "items",
    calls: 1, cached: 2_000, fresh: 600, output: 100, freshIsCached: false, batch: true,
    monthly: [{ label: "10,000 items/month", units: 10_000 }, { label: "1,000,000 items/month", units: 1_000_000 }],
    assume: "2,000 tokens of instructions and examples (identical on every call), about 600 tokens per item (an email, a review, a form), and a 100-token structured answer.",
    notes: [
      "This is the job small models are made for. Test the smallest model first with a few hundred labelled examples.",
      "The instructions and examples repeat on every item, so caching and the Batch API stack well here.",
      "Use structured outputs so every answer parses; a retry for a broken answer doubles that item's cost.",
    ],
  },
];

export function buildCostPages({ page, esc, SITE, OUT, pricing, faqLd, faqHtml, footerLinks, src }) {
  const models = [...pricing.models].sort((a, b) => b.input + b.output - (a.input + a.output)); // most expensive first
  const urls = [];
  const bd = pricing.batchDiscount;

  // ---------- use-case cost pages ----------
  for (const u of USE_CASES) {
    const tokensLine = `${u.calls > 1 ? `${u.calls} calls × (` : ""}${n(u.cached)} reused + ${n(u.fresh)} new input tokens, ${n(u.output)} output tokens${u.calls > 1 ? ")" : ""}`;
    const unitRows = models
      .map((m) => {
        const plain = unitCost(m, u), cached = unitCost(m, u, { caching: true });
        return `<tr><td><a href="/pricing/claude/${m.id}/">${esc(m.name)}</a></td><td>${fmt(plain)}</td><td>${fmt(cached)}</td>${u.batch ? `<td>${fmt(cached * bd)}</td>` : ""}<td>${fmt(cached * 1000)}</td></tr>`;
      })
      .join("");
    const monthRows = models
      .map((m) => `<tr><td>${esc(short(m))}</td>${u.monthly.map((x) => `<td>${fmt(unitCost(m, u, { caching: true }) * x.units * (u.batch ? bd : 1))}</td>`).join("")}</tr>`)
      .join("");
    const cheapest = models[models.length - 1], priciest = models[0];
    const cMin = unitCost(cheapest, u, { caching: true }), cMax = unitCost(priciest, u, { caching: true });
    const faq = [
      [`How much does one ${u.unit} cost with the Claude API?`, `With prompt caching, from about ${fmt(cMin)} on ${cheapest.name} to about ${fmt(cMax)} on ${priciest.name}, for a ${u.unit} of ${tokensLine}. Without caching it is ${fmt(unitCost(cheapest, u))} to ${fmt(unitCost(priciest, u))}.`],
      [`How much does it cost per month?`, `${u.monthly.map((x) => `${x.label}: about ${fmt(unitCost(cheapest, u, { caching: true }) * x.units * (u.batch ? bd : 1))} on ${short(cheapest)} up to ${fmt(unitCost(priciest, u, { caching: true }) * x.units * (u.batch ? bd : 1))} on ${short(priciest)}`).join(". ")}${u.batch ? ", using the Batch API" : ""}, with caching.`],
      [`How can I make it cheaper?`, u.notes[0]],
    ];
    const others = USE_CASES.filter((o) => o.slug !== u.slug).map((o) => `<a href="/pricing/claude/cost/${o.slug}/">${esc(o.short)}</a>`).join(" · ");
    mkdirSync(join(OUT, "pricing/claude/cost", u.slug), { recursive: true });
    writeFileSync(
      join(OUT, "pricing/claude/cost", u.slug, "index.html"),
      page({
        title: `${u.title} (${pricing.updated.slice(0, 7)} prices)`,
        description: `Worked cost of a ${u.short.toLowerCase()} on every Claude model: per ${u.unit}, per 1,000 ${u.units} and per month, with and without prompt caching${u.batch ? " and the Batch API" : ""}.`,
        url: `${SITE}/pricing/claude/cost/${u.slug}/`,
        meta: faqLd(faq),
        body: `<p class="meta"><a href="/pricing/claude/">Claude API pricing</a> › Cost of a ${esc(u.short.toLowerCase())}</p><h1>${esc(u.title)}</h1>${src}<article>
<p class="lede">A worked estimate you can check line by line. Change the numbers to your own in the <a href="/tools/claude-api-cost-calculator/">cost calculator</a>.</p>
<h2>What we assume</h2><p>${esc(u.assume)}</p>
<h2>Cost per ${esc(u.unit)}</h2>
<table><thead><tr><th>Model</th><th>No caching</th><th>With caching</th>${u.batch ? "<th>Caching + Batch API</th>" : ""}<th>Per 1,000 ${esc(u.units)}, with caching</th></tr></thead><tbody>${unitRows}</tbody></table>
<p class="meta">"With caching" bills the reused prefix at the cache-read price${u.freshIsCached ? " and the new tokens at the 5-minute cache-write price, so the next turn can read them" : ""}. It leaves out the first cache write of each session, which is small next to the total.</p>
<h2>Cost per month</h2>
<table><thead><tr><th>Model</th>${u.monthly.map((x) => `<th>${esc(x.label)}</th>`).join("")}</tr></thead><tbody>${monthRows}</tbody></table>
<p class="meta">With caching${u.batch ? " and the Batch API" : ""}. API usage only: hosting, database and payment fees come on top.</p>
<h2>Where the money goes</h2><ul>${u.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<p>To check what a plan price leaves you after these costs, use the <a href="/tools/ai-saas-margin-calculator/">AI SaaS margin calculator</a>. To see how much caching saves on your own prompt sizes, use the <a href="/tools/prompt-caching-savings-calculator/">prompt caching savings calculator</a>.</p>
<h2>Questions</h2>${faqHtml(faq)}
<p class="meta">Other workloads: ${others}</p>
</article>${footerLinks}`,
      }),
    );
    urls.push(`${SITE}/pricing/claude/cost/${u.slug}/`);
  }

  // ---------- model-vs-model pages ----------
  const pairs = [];
  for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) pairs.push([models[i], models[j]]);
  for (const [a, b] of pairs) {
    // a is the more expensive model
    const ratioIn = a.input / b.input, ratioOut = a.output / b.output;
    const x = (r) => `${+r.toFixed(r >= 10 ? 0 : 1)}×`;
    const priceRows = [
      ["Input", a.input, b.input], ["Output", a.output, b.output],
      ["Cache write, 5 minutes", a.cacheWrite5m, b.cacheWrite5m], ["Cache write, 1 hour", a.cacheWrite1h, b.cacheWrite1h],
      ["Cache read", a.cacheRead, b.cacheRead],
      ["Batch API input", +(a.input * bd).toFixed(4), +(b.input * bd).toFixed(4)], ["Batch API output", +(a.output * bd).toFixed(4), +(b.output * bd).toFixed(4)],
    ].map(([k, va, vb]) => `<tr><td>${k}</td><td>$${va}</td><td>$${vb}</td></tr>`).join("");
    const longNote = [a, b].filter((m) => m.longPrompt).map((m) => `<p>${esc(m.name)} has a higher price when a prompt is over ${n(m.longPrompt.thresholdTokens)} tokens: $${m.longPrompt.input} input and $${m.longPrompt.output} output per million tokens for the whole request.</p>`).join("");
    const caseRows = USE_CASES.map((u) => {
      const ca = unitCost(a, u, { caching: true }), cb = unitCost(b, u, { caching: true });
      return `<tr><td><a href="/pricing/claude/cost/${u.slug}/">${esc(u.short)}</a>, per ${esc(u.unit)}</td><td>${fmt(ca)}</td><td>${fmt(cb)}</td><td>${fmt(ca - cb)}</td></tr>`;
    }).join("");
    // monthly gap for the chatbot at 1,000 users
    const chat = USE_CASES[0], chatUsers = chat.monthly[1];
    const gap = (unitCost(a, chat, { caching: true }) - unitCost(b, chat, { caching: true })) * chatUsers.units;
    const sa = short(a), sb = short(b);
    const faq = [
      [`Is ${sb} cheaper than ${sa}?`, `Yes. ${sb} costs $${b.input} input / $${b.output} output per million tokens, against $${a.input} / $${a.output} for ${sa}: ${x(ratioIn)} cheaper on input and ${x(ratioOut)} cheaper on output.`],
      [`How much more does ${sa} cost than ${sb} per month?`, `For a chatbot with ${chatUsers.label.toLowerCase()} (${n(chat.monthly[0].units)} messages each, with caching), about ${fmt(gap)} more per month on ${sa}. The worked examples on this page show the gap for other workloads.`],
      [`Should I use ${sa} or ${sb}?`, `Price is only half the answer. Run the same set of real tasks through both (a small eval of 50 to 200 examples is enough) and use ${sb} wherever it passes. Many apps route most requests to the cheaper model and send only hard ones to ${sa}.`],
    ];
    const slug = pairSlug(a, b);
    mkdirSync(join(OUT, "pricing/claude/compare", slug), { recursive: true });
    writeFileSync(
      join(OUT, "pricing/claude/compare", slug, "index.html"),
      page({
        title: `${sa} vs ${sb} pricing: ${x(ratioOut)} difference, worked examples (${pricing.updated.slice(0, 7)})`,
        description: `${a.name} costs $${a.input} / $${a.output} per million input / output tokens; ${b.name} costs $${b.input} / $${b.output}. Side-by-side prices, caching and batch rates, and what the gap means per request and per month.`,
        url: `${SITE}/pricing/claude/compare/${slug}/`,
        meta: faqLd(faq),
        body: `<p class="meta"><a href="/pricing/claude/">Claude API pricing</a> › ${esc(sa)} vs ${esc(sb)}</p><h1>${esc(a.name)} vs ${esc(b.name)}: price comparison</h1>${src}<article>
<p class="lede">${esc(sa)} costs ${x(ratioIn)} as much as ${esc(sb)} for input tokens and ${x(ratioOut)} as much for output tokens. Here is what that difference looks like on real workloads.</p>
<h2>Prices per million tokens</h2>
<table><thead><tr><th>Item</th><th><a href="/pricing/claude/${a.id}/">${esc(sa)}</a></th><th><a href="/pricing/claude/${b.id}/">${esc(sb)}</a></th></tr></thead><tbody>${priceRows}</tbody></table>
${longNote}
<p>Model ids: <code>${a.id}</code> and <code>${b.id}</code>.</p>
<h2>The gap on real workloads</h2>
<table><thead><tr><th>Workload</th><th>${esc(sa)}</th><th>${esc(sb)}</th><th>Difference</th></tr></thead><tbody>${caseRows}</tbody></table>
<p class="meta">With prompt caching. Each workload links to its assumptions (tokens per call, calls per task).</p>
<h2>How to decide</h2>
<ul><li>Measure, do not guess: run 50 to 200 of your real requests through both models and score the answers. Our guide to <a href="/blog/evals-for-claude-agents-typescript/">evals for Claude agents</a> shows a small setup.</li>
<li>Route by request: send routine requests to ${esc(sb)} and hand only the hard ones to ${esc(sa)}. Even a 70/30 split cuts most of the gap.</li>
<li>Cache first: <a href="/blog/prompt-caching-claude-agent-loop/">prompt caching</a> often saves more than a model switch on agent and chat workloads.</li></ul>
<h2>Questions</h2>${faqHtml(faq)}
<p class="meta">Other comparisons: ${pairs.filter(([p, q]) => pairSlug(p, q) !== slug).map(([p, q]) => `<a href="/pricing/claude/compare/${pairSlug(p, q)}/">${esc(short(p))} vs ${esc(short(q))}</a>`).join(" · ")}</p>
</article>${footerLinks}`,
      }),
    );
    urls.push(`${SITE}/pricing/claude/compare/${slug}/`);
  }

  // links for the hub and model pages
  const compareLinks = (m) => pairs.filter(([p, q]) => p.id === m.id || q.id === m.id).map(([p, q]) => `<li><a href="/pricing/claude/compare/${pairSlug(p, q)}/">${esc(short(p))} vs ${esc(short(q))}</a></li>`).join("");
  const hubHtml = `<h2>Model vs model</h2><ul>${pairs.map(([p, q]) => `<li><a href="/pricing/claude/compare/${pairSlug(p, q)}/">${esc(p.name)} vs ${esc(short(q))}</a></li>`).join("")}</ul>
<h2>What a typical app costs</h2><ul>${USE_CASES.map((u) => `<li><a href="/pricing/claude/cost/${u.slug}/">${esc(u.title)}</a></li>`).join("")}</ul>`;
  const costLinks = USE_CASES.map((u) => `<a href="/pricing/claude/cost/${u.slug}/">${esc(u.short.toLowerCase())}</a>`).join(", ");
  return { urls, hubHtml, compareLinks, costLinks };
}
