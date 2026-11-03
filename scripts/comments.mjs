#!/usr/bin/env node
// Manage blog comments stored in the COMMENTS KV namespace, via the Cloudflare REST API.
// Needs CLOUDFLARE_API_TOKEN (KV edit) and CLOUDFLARE_ACCOUNT_ID. Prints no secrets.
//
//   node scripts/comments.mjs list [--since 2026-11-03T00:00:00Z] [--all]   recent comments (all statuses with --all)
//   node scripts/comments.mjs pending                                        comments waiting for review
//   node scripts/comments.mjs approve <key>                                  publish a pending comment
//   node scripts/comments.mjs hide <key>                                     hide a comment (kept, not deleted)
//   node scripts/comments.mjs reply <key> "<text>"                           post an Agentwright reply under a comment
//   node scripts/comments.mjs post <slug> "<text>"                           post a top-level Agentwright comment (e.g. answering a dev.to question)
//
// <key> is the KV key printed by list/pending, e.g. c:my-post:1762170000000-ab12cd34

const NS = process.env.COMMENTS_KV_ID || "029f3679d0814f32bb474200f15b33b7";
const { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } = process.env;
if (!TOKEN || !ACCOUNT) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set.");
  process.exit(1);
}
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${NS}`;
const H = { Authorization: `Bearer ${TOKEN}` };

async function listKeys(prefix) {
  const keys = [];
  let cursor = "";
  do {
    const u = new URL(`${BASE}/keys`);
    u.searchParams.set("prefix", prefix);
    u.searchParams.set("limit", "1000");
    if (cursor) u.searchParams.set("cursor", cursor);
    const r = await (await fetch(u, { headers: H })).json();
    if (!r.success) throw new Error(JSON.stringify(r.errors));
    keys.push(...r.result.map((k) => k.name));
    cursor = r.result_info?.cursor || "";
  } while (cursor);
  return keys;
}
async function get(key) {
  const r = await fetch(`${BASE}/values/${encodeURIComponent(key)}`, { headers: H });
  if (!r.ok) throw new Error(`get ${key}: ${r.status}`);
  return r.json();
}
async function put(key, value) {
  const r = await fetch(`${BASE}/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
}
async function all() {
  const keys = await listKeys("c:");
  const rows = await Promise.all(keys.map(async (key) => ({ key, ...(await get(key)) })));
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}
const show = (c) =>
  console.log(`${c.key}\n  [${c.status}${c.team ? ", team" : ""}] ${c.createdAt} ${c.name} on /blog/${c.slug}/${c.parent ? ` (reply to ${c.parent})` : ""}\n  ${c.body.replace(/\n/g, "\n  ")}\n`);

const [cmd, a1, a2] = process.argv.slice(2);
const flag = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] ?? true : undefined;
};

if (cmd === "list") {
  const since = flag("--since");
  const rows = (await all()).filter((c) => (flag("--all") ? true : c.status !== "hidden") && (!since || c.createdAt >= since));
  rows.forEach(show);
  console.log(`${rows.length} comment(s)`);
} else if (cmd === "pending") {
  const rows = (await all()).filter((c) => c.status === "pending");
  rows.forEach(show);
  console.log(`${rows.length} pending`);
} else if ((cmd === "approve" || cmd === "hide") && a1) {
  const c = await get(a1);
  c.status = cmd === "approve" ? "published" : "hidden";
  await put(a1, c);
  console.log(`${a1} → ${c.status}`);
} else if (cmd === "reply" && a1 && a2) {
  const parent = await get(a1);
  const now = new Date();
  const id = crypto.randomUUID().slice(0, 8);
  const rec = {
    id,
    slug: parent.slug,
    parent: parent.parent || parent.id,
    name: "Agentwright",
    body: a2.trim(),
    team: true,
    status: "published",
    createdAt: now.toISOString(),
  };
  const key = `c:${parent.slug}:${now.getTime()}-${id}`;
  await put(key, rec);
  console.log(`replied: ${key} (https://agentwright.app/blog/${parent.slug}/#comments)`);
} else if (cmd === "post" && a1 && a2) {
  const now = new Date();
  const id = crypto.randomUUID().slice(0, 8);
  const rec = { id, slug: a1, parent: null, name: "Agentwright", body: a2.trim(), team: true, status: "published", createdAt: now.toISOString() };
  const key = `c:${a1}:${now.getTime()}-${id}`;
  await put(key, rec);
  console.log(`posted: ${key} (https://agentwright.app/blog/${a1}/#comments)`);
} else {
  console.log("usage: list [--since ISO] [--all] | pending | approve <key> | hide <key> | reply <key> \"text\" | post <slug> \"text\"");
  process.exit(cmd ? 1 : 0);
}
