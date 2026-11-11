// Deploys workers/cron (Cloudflare Worker "agentwright-cron") through the Cloudflare API, then sets its
// Cron Triggers (daily 07:00 KST + hourly X posting). Run from an INTERACTIVE session (unattended routines are not allowed to deploy):
//
//   node scripts/deploy-cron-worker.mjs
//
// Needs env CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, DEVTO_API_KEY, RESEND_API_KEY and the four X_* keys;
// BLUESKY_HANDLE + BLUESKY_APP_PASSWORD are added when both are set.
// The API keys are uploaded as worker secrets; no value is ever printed.
// The mail template is taken from the project's shared mail folder (render-mail.mjs) with its CLI part
// stripped, so alert mails look the same as every other "[Agentwright 알림]" mail.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "agentwright-cron";
const CRONS = [
  "0 22 * * *", // 22:00 UTC = 07:00 KST daily blog + dev.to (must match X_DAILY in workers/cron/index.mjs)
  "7 * * * *", // hourly at :07, X posts (content/x-queue.json) then Bluesky posts (content/bsky-queue.json)
];
const STATE_KV = "be212341e70a4670889b4f2a93acebd4"; // KV namespace agentwright-cron-state
const MAIL = process.env.MAIL_TEMPLATE ?? "/mnt/project-files/agentwright/mail/render-mail.mjs";

const SECRETS = ["DEVTO_API_KEY", "RESEND_API_KEY", "X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"];
for (const v of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", ...SECRETS]) {
  if (!process.env[v]) throw new Error(`${v} is not set`);
}
// Bluesky is optional: uploaded only when both are set (the worker skips Bluesky otherwise).
const OPTIONAL = ["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"];
const BSKY_DID = "did:plc:pvgxmysqaezcfmornmfrkjod"; // brand account, created 2026-11-11
if (OPTIONAL.every((v) => process.env[v])) {
  SECRETS.push(...OPTIONAL);
  // The env var may still hold the signup handle (agentwright.bsky.social); after the switch to
  // @agentwright.app that name no longer logs in, so upload the account's CURRENT handle instead.
  const prof = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${BSKY_DID}`).then((r) => r.json()).catch(() => ({}));
  if (prof.handle && prof.handle !== "handle.invalid" && prof.handle !== process.env.BLUESKY_HANDLE) {
    console.log(`Bluesky: using current handle @${prof.handle} instead of BLUESKY_HANDLE`);
    process.env.BLUESKY_HANDLE = prof.handle;
  }
}
else console.log("Bluesky secrets not set: deploying without Bluesky posting");
const api = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${NAME}`;
const auth = { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };

const mail = readFileSync(MAIL, "utf8")
  .replace(/^import .*node:fs.*\n/m, "")
  .replace(/\nif \(import\.meta\.url[\s\S]*$/, "\n");
if (/readFileSync|process\./.test(mail)) throw new Error("render-mail.mjs still uses Node APIs after stripping; update this script");

const modules = {
  "index.mjs": readFileSync(join(root, "workers/cron/index.mjs"), "utf8"),
  "bsky.mjs": readFileSync(join(root, "workers/cron/bsky.mjs"), "utf8"),
  "devto-format.mjs": readFileSync(join(root, "scripts/lib/devto-format.mjs"), "utf8"),
  "render-mail.mjs": mail,
};
const metadata = {
  main_module: "index.mjs",
  compatibility_date: "2026-11-01",
  bindings: [
    ...SECRETS.map((name) => ({ type: "secret_text", name, text: process.env[name] })),
    { type: "kv_namespace", name: "STATE", namespace_id: STATE_KV },
  ],
};
const form = new FormData();
form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
for (const [name, src] of Object.entries(modules)) form.append(name, new Blob([src], { type: "application/javascript+module" }), name);

async function call(url, init) {
  const res = await fetch(url, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(`${init.method} ${url.replace(/accounts\/[^/]+/, "accounts/…")} → ${res.status} ${JSON.stringify(data.errors ?? data).slice(0, 300)}`);
  return data.result;
}

await call(api, { method: "PUT", body: form });
console.log(`uploaded ${NAME} (${Object.keys(modules).join(", ")})`);
const sched = await call(`${api}/schedules`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(CRONS.map((cron) => ({ cron }))) });
console.log(`cron set: ${JSON.stringify(sched.schedules ?? sched)}`);
