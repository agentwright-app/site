// Lists what people wrote to @agentwright.app on Bluesky that we have not handled yet:
// replies under our posts (and under our own replies), posts that mention us, and quotes of our posts.
//
//   node scripts/bsky-replies.mjs            readable list
//   node scripts/bsky-replies.mjs --json     the same as JSON
//
// Read-only: public Bluesky API, no login, no secrets, nothing is posted.
// A post counts as handled when (a) we already replied under it, (b) content/bsky-queue.json has an item
// with `reply_to` set to it, or (c) it is listed in content/bsky-replies-seen.json (looked at, no answer).
// To answer: add {id, at, text, reply_to: "<uri>"} to content/bsky-queue.json; the cron worker posts it at
// the first :07 at or after `at` and refuses a reply to anyone who did not write to us first.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DID = "did:plc:pvgxmysqaezcfmornmfrkjod";
const HANDLE = "agentwright.app";
const API = "https://public.api.bsky.app/xrpc/";
const SEARCH = "https://api.bsky.app/xrpc/"; // search is refused on the public host

async function get(base, nsid, query) {
  const res = await fetch(`${base}${nsid}?${new URLSearchParams(query)}`, { headers: { "user-agent": "agentwright-replies-check" } });
  if (!res.ok) throw new Error(`${nsid} answered ${res.status}`);
  return res.json();
}

/** Pure part, tested in tests/bsky-replies.test.mjs. */
export function pending(candidates, { queue, seen, answered }) {
  const done = new Set([...(queue.posts ?? []).map((p) => p.reply_to), ...(seen.seen ?? []).map((s) => s.uri), ...answered].filter(Boolean));
  const out = new Map();
  for (const c of candidates) if (c.author.did !== DID && !done.has(c.uri) && !out.has(c.uri)) out.set(c.uri, c);
  return [...out.values()].sort((a, b) => a.at.localeCompare(b.at));
}

const view = (post, kind, on) => ({
  uri: post.uri,
  kind,
  at: post.record?.createdAt ?? post.indexedAt,
  author: { did: post.author.did, handle: post.author.handle, name: post.author.displayName ?? "" },
  text: post.record?.text ?? "",
  on,
  url: `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split("/").pop()}`,
});

async function collect() {
  const candidates = [];
  const answered = new Set();
  const problems = [];
  const mine = [];
  let cursor;
  for (let page = 0; page < 2; page++) {
    const f = await get(API, "app.bsky.feed.getAuthorFeed", { actor: DID, limit: 100, filter: "posts_with_replies", ...(cursor ? { cursor } : {}) });
    mine.push(...f.feed.map((x) => x.post).filter((p) => p.author.did === DID));
    cursor = f.cursor;
    if (!cursor) break;
  }
  for (const p of mine) {
    // Whatever we replied to is answered, even if that post is hidden from thread views.
    if (p.record.reply?.parent?.uri) answered.add(p.record.reply.parent.uri);
    const on = p.record.text.slice(0, 80);
    try {
      if (p.replyCount > 0) {
        const t = await get(API, "app.bsky.feed.getPostThread", { uri: p.uri, depth: 1, parentHeight: 0 });
        for (const r of t.thread?.replies ?? []) if (r.post) candidates.push(view(r.post, "reply", on));
      }
      if (p.quoteCount > 0) {
        const q = await get(API, "app.bsky.feed.getQuotes", { uri: p.uri, limit: 50 });
        for (const post of q.posts ?? []) candidates.push(view(post, "quote", on));
      }
    } catch (e) {
      problems.push(`${p.uri}: ${e.message}`);
    }
  }
  try {
    const s = await get(SEARCH, "app.bsky.feed.searchPosts", { q: "*", mentions: HANDLE, limit: 50, sort: "latest" });
    for (const post of s.posts ?? []) candidates.push(view(post, "mention", ""));
  } catch (e) {
    problems.push(`mention search: ${e.message}`);
  }
  return { candidates, answered, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const read = (f) => JSON.parse(readFileSync(join(root, f), "utf8"));
  const { candidates, answered, problems } = await collect();
  const list = pending(candidates, { queue: read("content/bsky-queue.json"), seen: read("content/bsky-replies-seen.json"), answered });
  for (const c of list) {
    try {
      const a = await get(API, "app.bsky.actor.getProfile", { actor: c.author.did });
      Object.assign(c.author, { followers: a.followersCount, posts: a.postsCount, created: a.createdAt, bio: (a.description ?? "").slice(0, 200) });
    } catch {}
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify({ pending: list, problems }, null, 2));
  else {
    console.log(`${list.length} post(s) written to us and not handled yet`);
    for (const c of list) {
      console.log(`\n[${c.kind}] ${c.at}  @${c.author.handle} (${c.author.name}; followers ${c.author.followers ?? "?"}, posts ${c.author.posts ?? "?"})`);
      if (c.on) console.log(`  on our post: ${c.on}`);
      console.log(`  text: ${c.text.replace(/\n/g, "\n        ")}`);
      console.log(`  reply_to: ${c.uri}\n  ${c.url}`);
    }
    for (const p of problems) console.log(`\nPROBLEM: ${p}`);
  }
  process.exit(problems.length ? 2 : 0);
}
