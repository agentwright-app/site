#!/usr/bin/env node
// Tell Bing / Yandex / Naver / Seznam (IndexNow) about public URLs.
// Usage: node scripts/indexnow.mjs            -> every URL in the live sitemap
//        node scripts/indexnow.mjs <url> ...   -> only these URLs
// The key is public by design (served at /<key>.txt from public/); no secret needed.
// Uses the LIVE sitemap, so date-gated future posts are never submitted early.
const SITE = "https://agentwright.app";
const KEY = "fc619d2ce783e98da465042107280c3c";

let urls = process.argv.slice(2);
if (urls.length === 0) {
  const xml = await (await fetch(`${SITE}/sitemap.xml`)).text();
  urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}
if (urls.length === 0) {
  console.error("No URLs found.");
  process.exit(1);
}
const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: "agentwright.app", key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urls.length} URL(s)`);
if (res.status >= 300) process.exit(1);
