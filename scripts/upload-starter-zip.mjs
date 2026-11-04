#!/usr/bin/env node
/**
 * Upload a Starter release zip as the buyer download (`asset:starter.zip` in the
 * LICENSES KV namespace, served by functions/api/download.ts) and verify it.
 *
 *   node scripts/upload-starter-zip.mjs <path/to/agentwright-starter-X.Y.Z.zip> [--dry-run]
 *
 * Uses CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Before overwriting, the
 * current zip is saved next to the new one as `<name>.previous-download.zip`,
 * so a bad upload can be undone by running this script on that file.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";

const LICENSES_NS = "039f10c904d84cc6b81625ab46971def";
const KEY = "asset%3Astarter.zip";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const file = args.find((a) => !a.startsWith("--"));
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!file) throw new Error("usage: node scripts/upload-starter-zip.mjs <zip> [--dry-run]");
if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set");

const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${LICENSES_NS}/values/${KEY}`;
const auth = { Authorization: `Bearer ${token}` };
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const next = await readFile(file);
if (next.subarray(0, 2).toString() !== "PK") throw new Error(`${file} is not a zip`);
if (next.length > 25 * 1024 * 1024) throw new Error("KV values are limited to 25 MiB");

const cur = await fetch(url, { headers: auth });
let current = null;
if (cur.ok) current = Buffer.from(await cur.arrayBuffer());
else if (cur.status !== 404) throw new Error(`reading current zip failed: HTTP ${cur.status}`);

console.log(`current: ${current ? `${current.length} bytes sha256 ${sha(current)}` : "none"}`);
console.log(`new:     ${next.length} bytes sha256 ${sha(next)}`);
if (current && sha(current) === sha(next)) {
  console.log("already uploaded, nothing to do");
  process.exit(0);
}
if (dryRun) process.exit(0);

if (current) {
  const backup = join(dirname(file), `${basename(file, ".zip")}.previous-download.zip`);
  await writeFile(backup, current);
  console.log(`backup:  ${backup}`);
}

const put = await fetch(url, { method: "PUT", headers: { ...auth, "content-type": "application/octet-stream" }, body: next });
if (!put.ok) throw new Error(`upload failed: HTTP ${put.status} ${await put.text()}`);

const check = Buffer.from(await (await fetch(url, { headers: auth })).arrayBuffer());
if (sha(check) !== sha(next)) throw new Error("verification failed: stored zip differs from the file");
console.log("uploaded and verified");
