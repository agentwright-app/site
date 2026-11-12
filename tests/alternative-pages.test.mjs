// node --test tests/alternative-pages.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAlternatives, loadShared, validateAlternative, rich } from "../scripts/lib/alternative-pages.mjs";
import { guideTokens } from "../scripts/lib/guide-pages.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const shared = loadShared(root);

const page = (over = {}) => ({
  slug: "alternatives/example",
  title: "An Example alternative",
  description: "What Example is and when to stay with it.",
  hubLine: "Example next to our kit.",
  lede: "Example is a kit.",
  checked: "2026-11-12",
  published: "2026-11-12",
  other: { name: "Example", url: "https://example.com", sources: [{ url: "https://example.com", what: "home page" }] },
  about: ["Example is a kit."],
  rows: [{ label: "Refund", other: "30 days.", oursKey: "refund" }],
  stayIf: ["You need what Example has."],
  pickIf: ["You need what we have."],
  ...over,
});
const problems = (data) => {
  try {
    validateAlternative(data, { root, shared, file: "test.json" });
    return "";
  } catch (e) {
    return e.message;
  }
};

test("the pages in content/alternatives pass their own rules", () => {
  const all = loadAlternatives(root);
  assert.ok(all.length >= 3);
  for (const p of all) assert.match(p.slug, /^alternatives\/[a-z0-9-]+$/);
});

test("a valid page has no problems", () => {
  assert.equal(problems(page()), "");
});

test("every row must say something about the other product", () => {
  assert.match(problems(page({ rows: [{ label: "Teams", other: "", oursKey: "teams" }] })), /`other` is empty/);
});

test("our side of a row comes from exactly one place, and oursKey must exist", () => {
  assert.match(problems(page({ rows: [{ label: "Refund", other: "30 days.", oursKey: "refund", ours: "14 days." }] })), /exactly one of/);
  assert.match(problems(page({ rows: [{ label: "Refund", other: "30 days." }] })), /exactly one of/);
  assert.match(problems(page({ rows: [{ label: "Refund", other: "30 days.", oursKey: "nope" }] })), /not a cell of our kit/);
});

test("a page without sources, or without a reason to stay with the other product, is refused", () => {
  assert.match(problems(page({ other: { name: "Example", url: "https://example.com", sources: [] } })), /other\.sources/);
  assert.match(problems(page({ stayIf: [] })), /stayIf/);
});

test("a linked post must exist and be public on the page's published date", () => {
  const gap = (href) => page({ gaps: [{ title: "Metering", text: "Store usage.", posts: [{ href, title: "A post" }] }] });
  assert.equal(problems(gap("/blog/meter-claude-api-costs-per-user-nextjs/")), "");
  assert.match(problems(gap("/blog/no-such-post/")), /does not exist/);
  // This post is dated 2026-12-14, after the test page's published date.
  assert.match(problems(gap("/blog/kill-switches-ai-agent-models-tools/")), /would be a 404/);
});

test("rich: escapes HTML, then renders code and links; only outside links get nofollow", () => {
  const SITE = "https://agentwright.app";
  assert.equal(rich(esc, SITE, "a <b> & `x.ts`"), "a &lt;b&gt; &amp; <code>x.ts</code>");
  assert.equal(rich(esc, SITE, "see [What's inside](/inside/)"), `see <a href="/inside/">What's inside</a>`);
  assert.equal(rich(esc, SITE, "[them](https://example.com/a)"), `<a href="https://example.com/a" rel="nofollow noopener">them</a>`);
  assert.equal(rich(esc, SITE, "[us](https://agentwright.app/faq/)"), `<a href="https://agentwright.app/faq/">us</a>`);
  assert.equal(rich(esc, SITE, "[x](javascript:alert(1))"), "[x](javascript:alert(1))");
});

test("guide tokens: prices keep two digits of cents, and only the kit's models are listed", () => {
  const pricing = {
    updated: "2026-11-10",
    source: "https://example.com/pricing",
    models: [
      { id: shared.kit.models[0], name: "Kit model", input: 0.1, output: 2.5 },
      { id: "claude-not-in-kit-9-9", name: "Other model", input: 1, output: 2 },
    ],
  };
  const t = guideTokens({ esc, root, pricing, buyUrl: "https://example.com/buy" });
  assert.match(t.models_table, /<td>\$0\.10<\/td><td>\$2\.50<\/td>/);
  assert.doesNotMatch(t.models_table, /Other model/);
  assert.match(t.weaker_list, /^<ul>/);
  assert.match(t.buy_box, /href="https:\/\/example\.com\/buy"/);
});
