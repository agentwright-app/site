// npm test   (no network, no secrets)
import { test } from "node:test";
import assert from "node:assert/strict";
import { meta, linkFacets, graphemes } from "../workers/cron/bsky.mjs";

test("meta: an apostrophe inside a double-quoted value does not end it", () => {
  const html = `<meta property="og:title" content="How to price an AI SaaS plan so heavy users don't eat your margin — Agentwright">`;
  assert.equal(meta(html, "og:title"), "How to price an AI SaaS plan so heavy users don't eat your margin — Agentwright");
});

test("meta: a double quote inside a single-quoted value does not end it", () => {
  assert.equal(meta(`<meta name='description' content='Say "hi" to Claude'>`, "description"), 'Say "hi" to Claude');
});

test("meta: content before property, and never a neighbouring tag's content", () => {
  const html = `<meta content="width=device-width" name="viewport"><meta content="What's inside" property="og:title">`;
  assert.equal(meta(html, "og:title"), "What's inside");
  assert.equal(meta(html, "viewport"), "width=device-width");
});

test("meta: description and og:description are different tags", () => {
  const html = `<meta name="description" content="plain">\n<meta property="og:description" content="Claude's own">`;
  assert.equal(meta(html, "description"), "plain");
  assert.equal(meta(html, "og:description"), "Claude's own");
});

test("meta: entities are decoded once, &amp; last", () => {
  const html = `<meta property="og:title" content="A &amp; B &quot;C&quot; D&#39;s &lt;e&gt; &amp;quot;">`;
  assert.equal(meta(html, "og:title"), `A & B "C" D's <e> &quot;`);
});

test("meta: a missing tag gives an empty string", () => {
  assert.equal(meta(`<title>x</title><meta name="robots" content="index">`, "og:image"), "");
});

test("linkFacets: byte offsets, trailing punctuation left out", () => {
  const text = "Café: add https://agentwright.app/mcp.";
  const [f] = linkFacets(text);
  assert.equal(f.features[0].uri, "https://agentwright.app/mcp");
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(text).slice(f.index.byteStart, f.index.byteEnd)), "https://agentwright.app/mcp");
});

test("graphemes: counts what a reader sees", () => {
  assert.equal(graphemes("a👋🏽é"), 3);
});
