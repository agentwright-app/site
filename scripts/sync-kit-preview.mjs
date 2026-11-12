// Copies the PUBLIC preview of Agentwright Starter into content/kit/ so the site can show
// what a buyer gets: the file list, the changelog, the docs and a few source files in full.
//
//   node scripts/sync-kit-preview.mjs /path/to/starter      (a checkout of agentwright-app/starter)
//
// Run it after every Starter release, commit content/kit/ and deploy. This repository is public:
// only the files named in PREVIEW_FILES are copied in full. Everything else appears by name only.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
if (!src || !existsSync(join(src, "package.json"))) {
  console.error("usage: node scripts/sync-kit-preview.mjs /path/to/starter");
  process.exit(1);
}
const OUT = join(root, "content/kit");

// Source files shown in full on /inside/ ("read the code before you buy").
const PREVIEW_FILES = ["lib/agent/loop.ts", "lib/billing/metering.ts", "evals/cases.ts"];
// Docs published under /docs/. The other files in docs/ ship with the kit only.
const DOCS = ["setup.md", "deploy.md", "pricing.md", "licensing.md", "polar.md"];

const git = (...args) => execFileSync("git", ["-C", src, ...args], { encoding: "utf8" }).trim();
// Files are copied from the working tree and labelled with HEAD, so the tree must be clean.
if (git("status", "--porcelain")) {
  console.error("The Starter checkout has uncommitted changes. Commit or stash them first.");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
// Versions a buyer gets from `npm ci` (the lockfile), not the ranges in package.json.
const lock = JSON.parse(readFileSync(join(src, "package-lock.json"), "utf8"));
const locked = (name) => lock.packages?.[`node_modules/${name}`]?.version ?? pkg.dependencies[name];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "files"), { recursive: true });
mkdirSync(join(OUT, "docs"), { recursive: true });

// Every tracked file with its line count (lockfile and generated migration snapshots left out).
const SKIP = /^(package-lock\.json|drizzle\/meta\/)/;
const tracked = git("ls-files").split("\n").filter((f) => f && !SKIP.test(f));
const lines = (f) => readFileSync(join(src, f), "utf8").split("\n").length - 1;
const files = tracked.map((path) => ({ path, lines: lines(path) }));
const isCode = (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".d.ts");
// Test files only: tests/ also holds fixtures and helpers.
const isTest = (p) => /^tests\/[^/]+\.test\.ts$/.test(p);

// One-line notes per file come from the "## Layout" block of the Starter's README.
const readme = readFileSync(join(src, "README.md"), "utf8");
const layout = (readme.match(/## Layout\n```\n([\s\S]*?)\n```/) ?? [])[1] ?? "";

for (const f of PREVIEW_FILES) {
  mkdirSync(dirname(join(OUT, "files", f)), { recursive: true });
  copyFileSync(join(src, f), join(OUT, "files", f));
}
for (const d of DOCS) copyFileSync(join(src, "docs", d), join(OUT, "docs", d));
copyFileSync(join(src, "CHANGELOG.md"), join(OUT, "CHANGELOG.md"));
copyFileSync(join(src, ".github/workflows/ci.yml"), join(OUT, "ci.yml"));
copyFileSync(join(src, ".env.example"), join(OUT, "env.example"));
writeFileSync(join(OUT, "layout.txt"), layout + "\n");

const testCount = tracked
  .filter(isTest)
  .reduce((n, f) => n + (readFileSync(join(src, f), "utf8").match(/^\s*(?:test|it)\(/gm) ?? []).length, 0);

// Models that ship with a price row (lib/billing/pricing.ts BUILTIN_PRICES), in file order.
const pricingSrc = readFileSync(join(src, "lib/billing/pricing.ts"), "utf8");
const models = [...new Set([...pricingSrc.matchAll(/^\s*row\("([a-z0-9-]+)"/gm)].map((m) => m[1]))];
const longContext = [...new Set([...pricingSrc.matchAll(/^\s*row\("([a-z0-9-]+)"[^\n]*minPromptTokens/gm)].map((m) => m[1]))];

const meta = {
  version: pkg.version,
  models,
  longContextModels: longContext,
  commit: git("rev-parse", "--short", "HEAD"),
  commitDate: git("log", "-1", "--format=%cs"),
  dependencies: Object.fromEntries(Object.keys(pkg.dependencies).map((name) => [name, locked(name)])),
  scripts: Object.keys(pkg.scripts),
  previewFiles: PREVIEW_FILES,
  docs: DOCS,
  counts: {
    files: files.length,
    codeFiles: files.filter((f) => isCode(f.path)).length,
    codeLines: files.filter((f) => isCode(f.path)).reduce((n, f) => n + f.lines, 0),
    testFiles: files.filter((f) => isTest(f.path)).length,
    tests: testCount,
    migrations: files.filter((f) => /^drizzle\/\d+.*\.sql$/.test(f.path)).length,
  },
  files,
};
writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(`content/kit/ synced from ${src} @ ${meta.commit} (v${meta.version}): ${JSON.stringify(meta.counts)}`);
