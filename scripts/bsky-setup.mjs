// One-off Bluesky setup for the brand account (2026-11-11). Run from an interactive session.
//
//   node scripts/bsky-setup.mjs check     # log in with the App Password, print DID + handle + profile state
//   node scripts/bsky-setup.mjs handle    # add TXT _atproto.agentwright.app = did=<DID> at Porkbun, then switch handle
//   node scripts/bsky-setup.mjs profile   # name, bio, avatar, banner, "bot" self-label
//
// Env: BLUESKY_APP_PASSWORD (BLUESKY_HANDLE is not used for login: we log in by DID); for `handle` also PORKBUN_API_KEY, PORKBUN_SECRET_KEY.
// Never prints secrets. The `handle` step only ADDS a record (it never deletes or edits other DNS records;
// _polar-challenge, google-site-verification and v=MCPv1 TXT records must stay).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { login, graphemes } from "../workers/cron/bsky.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PDS = "https://bsky.social";
const DOMAIN = "agentwright.app";

const PROFILE = {
  displayName: "Agentwright",
  description:
    "Starter kit for shipping Claude-powered agent SaaS: Next.js, auth, billing, metering, MCP and evals, done for you.\n\nPosts here are scheduled automatically. Questions: comments on our blog, agentwright.app/blog",
  // Bluesky crops avatars to a circle: use the full-bleed square mark, not the rounded app icon.
  avatar: process.env.BSKY_AVATAR ?? "/mnt/project-files/agentwright/brand/avatar-circle-800.png",
  banner: process.env.BSKY_BANNER ?? "/mnt/project-files/agentwright/brand/x/header-1500x500.png",
};

async function xrpc(method, nsid, { token, body, raw, type, query = "" } = {}) {
  const res = await fetch(`${PDS}/xrpc/${nsid}${query}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": type ?? "application/json" },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${nsid} → ${res.status} ${data.error ?? ""} ${data.message ?? ""}`);
  return data;
}

async function porkbun(path, body = {}) {
  const res = await fetch(`https://api.porkbun.com/api/json/v3/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apikey: process.env.PORKBUN_API_KEY, secretapikey: process.env.PORKBUN_SECRET_KEY, ...body }),
  });
  const data = await res.json();
  if (data.status !== "SUCCESS") throw new Error(`Porkbun ${path} → ${data.message ?? res.status}`);
  return data;
}

async function getProfileRecord(s) {
  try {
    const r = await xrpc("GET", "com.atproto.repo.getRecord", { token: s.token, query: `?repo=${s.did}&collection=app.bsky.actor.profile&rkey=self` });
    return { record: r.value, cid: r.cid };
  } catch {
    return { record: { $type: "app.bsky.actor.profile" }, cid: undefined };
  }
}

async function upload(s, file, type = "image/png") {
  const r = await xrpc("POST", "com.atproto.repo.uploadBlob", { token: s.token, raw: readFileSync(file), type });
  return r.blob;
}

const cmd = process.argv[2];
// Log in by DID: the signup handle in BLUESKY_HANDLE no longer works after the switch to @agentwright.app.
const s = await login({ ...process.env, BLUESKY_HANDLE: "did:plc:pvgxmysqaezcfmornmfrkjod" });
const me = await xrpc("GET", "com.atproto.server.getSession", { token: s.token });
console.log(`logged in: did ${s.did}, handle @${me.handle}`);

if (cmd === "check") {
  const { record } = await getProfileRecord(s);
  console.log(`profile: name=${JSON.stringify(record.displayName ?? "")}, avatar=${record.avatar ? "yes" : "no"}, banner=${record.banner ? "yes" : "no"}, labels=${JSON.stringify(record.labels?.values?.map((v) => v.val) ?? [])}`);
} else if (cmd === "handle") {
  const want = `did=${s.did}`;
  const existing = await porkbun(`dns/retrieveByNameType/${DOMAIN}/TXT/_atproto`);
  if (existing.records?.some((r) => r.content === want)) console.log("TXT _atproto already present");
  else if (existing.records?.length) throw new Error("a different _atproto TXT exists; check it by hand before changing anything");
  else {
    const r = await porkbun(`dns/create/${DOMAIN}`, { name: "_atproto", type: "TXT", content: want, ttl: "600" });
    console.log(`TXT _atproto created (Porkbun id ${r.id})`);
  }
  // Wait until public DNS shows it, then switch the handle.
  for (let i = 0; i < 30; i++) {
    const q = await fetch(`https://cloudflare-dns.com/dns-query?name=_atproto.${DOMAIN}&type=TXT`, { headers: { accept: "application/dns-json" } }).then((r) => r.json());
    if (q.Answer?.some((a) => a.data.includes(want))) break;
    console.log("waiting for DNS…");
    await new Promise((r) => setTimeout(r, 20000));
  }
  await xrpc("POST", "com.atproto.identity.updateHandle", { token: s.token, body: { handle: DOMAIN } });
  console.log(`handle switched to @${DOMAIN}`);
} else if (cmd === "profile") {
  const n = graphemes(PROFILE.description);
  if (n > 256) throw new Error(`bio is ${n} graphemes (max 256)`);
  const { record, cid } = await getProfileRecord(s);
  const labels = new Set(record.labels?.values?.map((v) => v.val) ?? []);
  labels.add("bot");
  const next = {
    ...record,
    $type: "app.bsky.actor.profile",
    displayName: PROFILE.displayName,
    description: PROFILE.description,
    avatar: await upload(s, PROFILE.avatar),
    banner: await upload(s, PROFILE.banner),
    labels: { $type: "com.atproto.label.defs#selfLabels", values: [...labels].map((val) => ({ val })) },
  };
  await xrpc("POST", "com.atproto.repo.putRecord", {
    token: s.token,
    body: { repo: s.did, collection: "app.bsky.actor.profile", rkey: "self", record: next, ...(cid ? { swapRecord: cid } : {}) },
  });
  console.log(`profile updated (bio ${n} graphemes, labels ${[...labels].join(",")})`);
} else {
  console.log("usage: node scripts/bsky-setup.mjs check|handle|profile");
}
