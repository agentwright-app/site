// Prints site traffic from the STATS KV namespace (filled by functions/api/hit.ts).
// Usage: node scripts/stats.mjs [since YYYY-MM-DD]   (needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
const NS = process.env.STATS_KV_ID ?? "3ccc8a8bd1be4b8f90186b90c8a4614b";
const since = process.argv[2] ?? "2000-01-01";
const base = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${NS}`;
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };

async function keys(prefix) {
  const out = [];
  let cursor = "";
  do {
    const r = await (await fetch(`${base}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${cursor}` : ""}`, { headers })).json();
    if (!r.success) throw new Error(JSON.stringify(r.errors));
    out.push(...r.result.map((k) => k.name));
    cursor = r.result_info?.cursor ?? "";
  } while (cursor);
  return out;
}
async function value(key) {
  return Number(await (await fetch(`${base}/values/${encodeURIComponent(key)}`, { headers })).text()) || 0;
}
async function sum(prefix, group) {
  const totals = {};
  for (const k of await keys(prefix)) {
    const day = k.split(":")[1];
    if (day < since) continue;
    const g = group(k);
    totals[g] = (totals[g] ?? 0) + (await value(k));
  }
  return totals;
}
const uv = await sum("uv:", (k) => k.split(":")[1]);
const pv = await sum("pv:", (k) => k.split(":").slice(2).join(":"));
const ref = await sum("ref:", (k) => k.split(":").slice(2).join(":"));
const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
console.log(`Since ${since}: ${total(uv)} visitors (unique per day), ${total(pv)} page views`);
console.log("\nVisitors by day:"); for (const [d, n] of Object.entries(uv).sort()) console.log(`  ${d}  ${n}`);
console.log("\nTop pages:"); for (const [p, n] of sorted(pv).slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${p}`);
console.log("\nWhere new visitors came from:"); for (const [h, n] of sorted(ref).slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${h}`);
