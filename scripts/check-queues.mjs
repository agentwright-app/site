// Checks content/x-queue.json and content/bsky-queue.json before a queue change is merged:
//
//   npm run check:queues            (or: node scripts/check-queues.mjs)
//
// It only reads files and prints; it never posts and needs no secrets. Exit code 1 = at least one error.
//
// Why (2026-11-12): two slips reached main that nothing checked.
//   1. X items with `at` 02:30 KST really went out at 03:07 KST. The cron worker runs at :07 every
//      hour, so the real posting time is the first :07 at or after `at`, and 03:00-07:00 KST is ruled out.
//   2. A Bluesky item linked to a blog post one day before the post's date. Posts open on their KST
//      date (functions/_middleware.ts); before that the page is 404 and the link card is empty.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { graphemes } from "../workers/cron/bsky.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOUR = 60 * 60 * 1000;
const WINDOW_MS = 3 * HOUR; // same as the worker: later than this and the item is skipped
const QUIET = [3, 7]; // X: nothing may really go out 03:00-07:00 KST (owner's rule, 2026-11-11)
const X_MAX = 280;
const BSKY_MAX = 300;

const kst = (ms) => new Date(ms + 9 * HOUR).toISOString().replace("T", " ").slice(0, 16);
const kstDay = (ms) => kst(ms).slice(0, 10);
const kstHour = (ms) => Number(kst(ms).slice(11, 13));

/** First hourly :07 run at or after `ms`. */
export function firstRun(ms) {
  const d = new Date(ms);
  d.setUTCMinutes(7, 0, 0);
  return d.getTime() < ms ? d.getTime() + HOUR : d.getTime();
}

function postDate(slug) {
  const file = join(root, "content/posts", `${slug}.md`);
  if (!existsSync(file)) return null;
  const head = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  return { date: head.match(/^date:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null, draft: /^draft:\s*"?true/m.test(head) };
}

/** Returns { rows, errors, warnings } for one queue. `now` only decides which items still count. */
export function checkQueue(name, queue, now = Date.now()) {
  const errors = [];
  const warnings = [];
  const rows = [];
  const isX = name === "x";
  const seen = new Set();
  const taken = new Set(); // runs already used: the worker posts at most one item per run
  const posts = [...(queue.posts ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const p of posts) {
    const tag = `${name}:${p.id}`;
    if (!p.id || seen.has(p.id)) errors.push(`${tag}: missing or duplicate id`);
    seen.add(p.id);
    const at = Date.parse(p.at);
    if (Number.isNaN(at)) {
      errors.push(`${tag}: \`at\` does not parse (${p.at})`);
      continue;
    }
    if (at <= now) continue; // already due: posted, skipped or about to be handled by the worker

    let run = firstRun(at);
    if (taken.has(run)) {
      while (taken.has(run)) run += HOUR;
      (run - at > WINDOW_MS ? errors : warnings).push(
        `${tag}: another item uses the same run, so this one waits until ${kst(run)} KST${run - at > WINDOW_MS ? " and would be skipped (more than 3 hours late)" : ""}`,
      );
    }
    taken.add(run);

    const len = isX ? [...p.text].length : graphemes(p.text);
    const max = isX ? X_MAX : BSKY_MAX;
    if (len > max) errors.push(`${tag}: ${len} characters, limit ${max}`);
    if (isX && kstHour(run) >= QUIET[0] && kstHour(run) < QUIET[1])
      errors.push(`${tag}: \`at\` ${kst(at)} KST really goes out at ${kst(run)} KST, inside 03:00-07:00 KST. Use 02:00 or earlier.`);

    const m = (p.link ?? "").match(/^https:\/\/agentwright\.app\/blog\/([a-z0-9-]+)\/?$/);
    if (m) {
      const post = postDate(m[1]);
      if (!post) errors.push(`${tag}: links to /blog/${m[1]}/ but content/posts/${m[1]}.md does not exist`);
      else if (post.draft) errors.push(`${tag}: links to a draft post (${m[1]})`);
      else if (!post.date || post.date > kstDay(run))
        errors.push(`${tag}: goes out ${kst(run)} KST but the linked post opens on ${post.date} (the page is 404 until then)`);
    }
    rows.push(`${p.id.padEnd(20)} at ${kst(at)}  really ${kst(run)} KST  ${String(len).padStart(3)}/${max}${p.link ? "  link" : ""}${p.community_id ? "  community" : ""}`);
  }
  return { rows, errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failed = false;
  for (const [name, file] of [["x", "content/x-queue.json"], ["bsky", "content/bsky-queue.json"]]) {
    const queue = JSON.parse(readFileSync(join(root, file), "utf8"));
    const { rows, errors, warnings } = checkQueue(name, queue);
    console.log(`\n${file}${queue.paused ? "  (PAUSED)" : ""}: ${rows.length} item(s) still to post`);
    for (const r of rows) console.log(`  ${r}`);
    for (const w of warnings) console.log(`  warning: ${w}`);
    for (const e of errors) console.log(`  ERROR: ${e}`);
    if (errors.length) failed = true;
  }
  console.log(failed ? "\nFAILED: fix the errors above before merging." : "\nOK");
  process.exit(failed ? 1 : 0);
}
