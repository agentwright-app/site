// Deploys workers/cron (Cloudflare Worker "agentwright-cron") through the Cloudflare API, then sets its
// daily Cron Trigger. Run from an INTERACTIVE session (unattended routines are not allowed to deploy):
//
//   node scripts/deploy-cron-worker.mjs
//
// Needs env CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, DEVTO_API_KEY, RESEND_API_KEY.
// The two API keys are uploaded as worker secrets; no value is ever printed.
// The mail template is taken from the project's shared mail folder (render-mail.mjs) with its CLI part
// stripped, so alert mails look the same as every other "[Agentwright 알림]" mail.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "agentwright-cron";
const CRON = "0 22 * * *"; // 22:00 UTC = 07:00 KST, before the 07:17 KST Claude check reads the results
const MAIL = process.env.MAIL_TEMPLATE ?? "/mnt/project-files/agentwright/mail/render-mail.mjs";

for (const v of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "DEVTO_API_KEY", "RESEND_API_KEY"]) {
  if (!process.env[v]) throw new Error(`${v} is not set`);
}
const api = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${NAME}`;
const auth = { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };

const mail = readFileSync(MAIL, "utf8")
  .replace(/^import .*node:fs.*\n/m, "")
  .replace(/\nif \(import\.meta\.url[\s\S]*$/, "\n");
if (/readFileSync|process\./.test(mail)) throw new Error("render-mail.mjs still uses Node APIs after stripping; update this script");

const modules = {
  "index.mjs": readFileSync(join(root, "workers/cron/index.mjs"), "utf8"),
  "devto-format.mjs": readFileSync(join(root, "scripts/lib/devto-format.mjs"), "utf8"),
  "render-mail.mjs": mail,
};
const metadata = {
  main_module: "index.mjs",
  compatibility_date: "2026-11-01",
  bindings: [
    { type: "secret_text", name: "DEVTO_API_KEY", text: process.env.DEVTO_API_KEY },
    { type: "secret_text", name: "RESEND_API_KEY", text: process.env.RESEND_API_KEY },
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
const sched = await call(`${api}/schedules`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify([{ cron: CRON }]) });
console.log(`cron set: ${JSON.stringify(sched.schedules ?? sched)}`);
