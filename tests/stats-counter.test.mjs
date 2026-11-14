// The visit counter (functions/api/hit.ts → lib/stats.ts) must not spend the KV writes that
// license issuing needs, and must not count crawlers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// lib/stats.ts has no imports, so it can be compiled here and loaded as it is.
const source = readFileSync(new URL("../lib/stats.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const S = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

/** A KV stand-in that counts writes. `failPuts` makes the next N puts throw. */
function fakeKv() {
  const kv = { data: new Map(), writes: 0, failPuts: 0 };
  kv.get = async (k) => kv.data.get(k) ?? null;
  kv.put = async (k, v) => {
    if (kv.failPuts > 0) { kv.failPuts--; throw new Error("429"); }
    kv.writes++;
    kv.data.set(k, v);
  };
  return kv;
}
const NOW = new Date("2026-11-14T10:00:00Z");
const noWait = async () => {};
const view = (path, extra = {}) => ({ path, referrer: "", event: "", utm: "", ...extra });
const day = (kv) => JSON.parse(kv.data.get("day:2026-11-14"));

test("a new visitor costs two writes, another page view one", async () => {
  const kv = fakeKv();
  assert.equal(await S.recordHit(kv, view("/", { referrer: "https://www.google.com/", utm: "x" }), "aaa", "Korea Telecom", NOW, noWait), "counted");
  assert.equal(kv.writes, 2);
  assert.equal(await S.recordHit(kv, view("/faq/"), "aaa", "Korea Telecom", NOW, noWait), "counted");
  assert.equal(kv.writes, 3);
  await S.recordHit(kv, view("/", { event: "buy_click" }), "", "Korea Telecom", NOW, noWait);
  assert.equal(kv.writes, 4);
  assert.deepEqual(day(kv), {
    w: 4, uv: 1, pv: { "/": 1, "/faq/": 1 }, ref: { "google.com": 1 }, utm: { x: 1 }, ev: { "buy_click:/": 1 }, net: { "Korea Telecom": 1 },
  });
});

test("counting stops at the daily write cap and writes nothing more", async () => {
  const kv = fakeKv();
  for (let i = 0; i < 300; i++) await S.recordHit(kv, view("/"), `v${i}`, "", NOW, noWait);
  assert.equal(kv.writes, S.DAILY_WRITE_CAP);
  assert.equal(day(kv).uv, S.DAILY_WRITE_CAP / 2);
  assert.equal(await S.recordHit(kv, view("/"), "late", "", NOW, noWait), "capped");
  // The next day starts from zero.
  assert.equal(await S.recordHit(kv, view("/"), "late", "", new Date("2026-11-15T00:00:01Z"), noWait), "counted");
});

test("a refused write is tried once more and the visitor is still counted as new once", async () => {
  // Marker written, then the day's document refused once.
  const kv2 = fakeKv();
  let puts = 0;
  const put = kv2.put;
  kv2.put = async (k, v) => { if (++puts === 2) throw new Error("429"); return put(k, v); };
  assert.equal(await S.recordHit(kv2, view("/"), "v", "", NOW, noWait), "counted");
  assert.equal(day(kv2).uv, 1);
  assert.equal(day(kv2).pv["/"], 1);
  // Both tries refused: given up without throwing.
  const kv3 = fakeKv();
  kv3.failPuts = 5;
  assert.equal(await S.recordHit(kv3, view("/"), "v", "", NOW, noWait), "failed");
});

test("only requests from our own pages are accepted", () => {
  assert.equal(S.isOwnOrigin("https://agentwright.app"), true);
  assert.equal(S.isOwnOrigin("https://www.agentwright.app"), true);
  assert.equal(S.isOwnOrigin(null), false);
  assert.equal(S.isOwnOrigin("https://agentwright.app.evil.example"), false);
  assert.equal(S.isOwnOrigin("http://agentwright.app"), false);
  assert.equal(S.isOwnOrigin("null"), false);
});

test("automated clients and cloud hosts are recognised, people are not", () => {
  for (const ua of ["", "Mozilla/5.0 (compatible; GPTBot/1.2)", "Mozilla/5.0 HeadlessChrome/140.0", "python-requests/2.32", "Mozilla/5.0 (compatible; AhrefsBot/7.0)", "ChatGPT-User/1.0", "axios/1.7"]) {
    assert.equal(S.isBotUserAgent(ua), true, ua);
  }
  for (const ua of [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
  ]) {
    assert.equal(S.isBotUserAgent(ua), false, ua);
  }
  for (const org of ["Amazon.com, Inc.", "AMAZON-02", "Google LLC", "Microsoft Corporation", "DigitalOcean, LLC", "Hetzner Online GmbH", "OVH SAS"]) {
    assert.equal(S.isHostingNetwork(org), true, org);
  }
  // Internet providers, carriers, and the networks iCloud Private Relay leaves through.
  for (const org of ["Korea Telecom", "Comcast Cable Communications, LLC", "SK Broadband Co Ltd", "Cloudflare, Inc.", "Akamai Technologies, Inc.", "Fastly, Inc.", "Google Fiber Inc.", ""]) {
    assert.equal(S.isHostingNetwork(org), false, org);
  }
});

test("the beacon body: made-up paths and unknown events are refused", () => {
  assert.deepEqual(S.parseHit('{"p":"/blog/x/","r":"https://t.co/a","u":"Product Hunt!"}'), { path: "/blog/x/", referrer: "https://t.co/a", event: "", utm: "producthunt" });
  assert.equal(S.parseHit("not json"), null);
  assert.equal(S.parseHit('{"p":"/<script>"}'), null);
  assert.equal(S.parseHit('{"p":"https://evil.example/"}'), null);
  assert.equal(S.parseHit(`{"p":"/${"a".repeat(200)}"}`), null);
  assert.equal(S.parseHit('{"p":"/","e":"made_up"}'), null);
  assert.equal(S.parseHit('{"p":"/","e":"buy_click"}').event, "buy_click");
});

test("a flood of different paths cannot grow the day's document without limit", () => {
  const doc = S.emptyDay();
  for (let i = 0; i < 1000; i++) S.applyHit(doc, view(`/p${i}`), false, "");
  assert.equal(Object.keys(doc.pv).length, 401);
  assert.equal(doc.pv["(other)"], 600);
});

test("one running copy of the function counts at most MINUTE_CAP hits a minute", () => {
  const t = Date.UTC(2026, 10, 14, 10, 0, 0);
  let ok = 0;
  for (let i = 0; i < 100; i++) if (S.underMinuteCap(t + i * 100)) ok++;
  assert.equal(ok, S.MINUTE_CAP);
  assert.equal(S.underMinuteCap(t + 60000), true);
});

test("referrers: our own pages are not a source", () => {
  assert.equal(S.referrerHost(""), "(direct)");
  assert.equal(S.referrerHost("https://www.google.com/search?q=x"), "google.com");
  assert.equal(S.referrerHost("https://agentwright.app/blog/"), "");
  assert.equal(S.referrerHost("garbage"), "(direct)");
});
