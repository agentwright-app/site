// Cross-posts blog posts to dev.to on a schedule, with canonical_url pointing at our blog.
//
//   node scripts/devto-crosspost.mjs            # publish at most ONE due post (what the daily trigger runs)
//   node scripts/devto-crosspost.mjs --dry-run  # show what would be published, write the converted body to dist-devto/
//
// Schedule: content/devto-schedule.json — [{ "slug", "date": "YYYY-MM-DD", "tags": [≤4 dev.to tags] }].
// A post is due when its schedule date AND its blog date are on/before today (Korea time).
// Idempotent and stateless: before publishing it lists our dev.to articles and skips any slug whose
// canonical_url already exists there, so a re-run or a missed day never double-posts.
//
// dev.to rules we follow (https://dev.to/guidelines-for-ai-assisted-articles-on-dev):
//  - no self-promotion: everything between <!-- site-only --> and <!-- /site-only --> is removed;
//  - AI disclosure + "questions go to the original post's comments" closing are appended.
// Needs DEVTO_API_KEY. Never prints the key.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, parse, toDevto } from "./lib/devto-format.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
const TODAY = process.env.BLOG_TODAY ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const UA = "agentwright-site-crosspost/1.0";

async function devto(path, init = {}) {
  const res = await fetch(`https://dev.to/api${path}`, {
    ...init,
    headers: { "api-key": process.env.DEVTO_API_KEY ?? "", "content-type": "application/json", "user-agent": UA, accept: "application/vnd.forem.api-v1+json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`dev.to ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function existingCanonicals() {
  const urls = new Set();
  for (let page = 1; page < 20; page++) {
    const list = await devto(`/articles/me/all?per_page=100&page=${page}`);
    for (const a of list) if (a.canonical_url) urls.add(a.canonical_url.replace(/#.*$/, ""));
    if (list.length < 100) break;
  }
  return urls;
}

async function main() {
  if (!DRY && !process.env.DEVTO_API_KEY) throw new Error("DEVTO_API_KEY is not set");
  const schedule = JSON.parse(readFileSync(join(root, "content/devto-schedule.json"), "utf8"));
  const due = [];
  for (const item of schedule.sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const { meta, body } = parse(readFileSync(join(root, "content/posts", `${item.slug}.md`), "utf8"));
    if (item.date <= TODAY && meta.date <= TODAY && meta.draft !== "true") due.push({ item, meta, body });
  }
  console.log(`today ${TODAY}; ${due.length} scheduled post(s) due`);

  const posted = process.env.DEVTO_API_KEY ? await existingCanonicals() : new Set();
  const next = due.filter((d) => !posted.has(`${SITE}/blog/${d.item.slug}/`));
  if (!next.length) return console.log("nothing to publish (all due posts are already on dev.to)");

  // One per run, oldest first, so a backlog drains one per day instead of in a burst.
  const { item, meta, body } = next[0];
  const url = `${SITE}/blog/${item.slug}/`;
  const markdown = toDevto(body, url);
  const article = { title: meta.title, body_markdown: markdown, published: true, canonical_url: url, description: meta.description, tags: (item.tags ?? []).slice(0, 4) };

  if (DRY) {
    // Write every due post's converted body for review; only the first would be published.
    mkdirSync(join(root, "dist-devto"), { recursive: true });
    for (const d of next) writeFileSync(join(root, "dist-devto", `${d.item.slug}.md`), toDevto(d.body, `${SITE}/blog/${d.item.slug}/`));
    return console.log(`[dry-run] would publish "${meta.title}" (tags: ${article.tags.join(", ")}); ${next.length - 1} more due after it; bodies in dist-devto/`);
  }
  const res = await devto("/articles", { method: "POST", body: JSON.stringify({ article }) });
  console.log(`published "${meta.title}" → ${res.url} (id ${res.id}); ${next.length - 1} more due after it`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
