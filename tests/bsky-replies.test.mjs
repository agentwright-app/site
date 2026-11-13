// npm test   (no network, no secrets)
import { test } from "node:test";
import assert from "node:assert/strict";
import { summoned } from "../workers/cron/bsky.mjs";
import { pending } from "../scripts/bsky-replies.mjs";
import { checkQueue } from "../scripts/check-queues.mjs";

const ME = "did:plc:pvgxmysqaezcfmornmfrkjod";
const mine = `at://${ME}/app.bsky.feed.post/aaa`;
const post = (record, did = "did:plc:other") => ({ uri: `at://${did}/app.bsky.feed.post/x`, author: { did }, record });

test("summoned: a reply to us, a mention of us and a quote of us", () => {
  assert.equal(summoned(post({ text: "hi", reply: { parent: { uri: mine }, root: { uri: mine } } }), ME), true);
  // a reply to someone else inside a thread we started
  assert.equal(summoned(post({ text: "hi", reply: { parent: { uri: "at://did:plc:third/app.bsky.feed.post/b" }, root: { uri: mine } } }), ME), true);
  assert.equal(summoned(post({ text: "@agentwright.app hi", facets: [{ features: [{ $type: "app.bsky.richtext.facet#mention", did: ME }] }] }), ME), true);
  assert.equal(summoned(post({ text: "look", embed: { $type: "app.bsky.embed.record", record: { uri: mine } } }), ME), true);
  assert.equal(summoned(post({ text: "look", embed: { $type: "app.bsky.embed.recordWithMedia", record: { record: { uri: mine } } } }), ME), true);
});

test("summoned: never a stranger's post, a mention of someone else, or our own post", () => {
  assert.equal(summoned(post({ text: "Claude API costs are high" }), ME), false);
  assert.equal(summoned(post({ text: "@x hi", facets: [{ features: [{ $type: "app.bsky.richtext.facet#mention", did: "did:plc:x" }] }] }), ME), false);
  assert.equal(summoned(post({ text: "hi", reply: { parent: { uri: "at://did:plc:pvgxmysqaezcfmornmfrkjodX/app.bsky.feed.post/a" } } }), ME), false);
  assert.equal(summoned(post({ text: "hi", reply: { parent: { uri: mine }, root: { uri: mine } } }, ME), ME), false);
  assert.equal(summoned(undefined, ME), false);
});

test("pending: answered, queued and seen posts are left out, duplicates collapse", () => {
  const c = (id, did = "did:plc:other") => ({ uri: `at://${did}/app.bsky.feed.post/${id}`, at: `2026-11-13T0${id}:00:00Z`, author: { did } });
  const list = pending([c(1), c(2), c(3), c(4), c(5), c(5), c(6, ME)], {
    queue: { posts: [{ id: "p" }, { id: "r", reply_to: c(2).uri }] },
    seen: { seen: [{ uri: c(3).uri }] },
    answered: new Set([c(4).uri]),
  });
  assert.deepEqual(list.map((x) => x.uri), [c(1).uri, c(5).uri]);
});

test("check-queues: a Bluesky reply needs a post URI and stays out of 03:00-07:00 KST", () => {
  const NOW = Date.parse("2026-11-12T00:00:00+09:00");
  const uri = "at://did:plc:zlctlmcmbw2xcacv33abhqxf/app.bsky.feed.post/3n24o635u5s2x";
  assert.deepEqual(checkQueue("bsky", { posts: [{ id: "r1", at: "2026-11-13T15:00:00+09:00", text: "ok", reply_to: uri }] }, NOW).errors, []);
  assert.equal(checkQueue("bsky", { posts: [{ id: "r1", at: "2026-11-13T04:00:00+09:00", text: "ok", reply_to: uri }] }, NOW).errors.length, 1);
  assert.equal(checkQueue("bsky", { posts: [{ id: "r1", at: "2026-11-13T15:00:00+09:00", text: "ok", reply_to: "https://bsky.app/profile/x/post/y" }] }, NOW).errors.length, 1);
  assert.equal(checkQueue("x", { posts: [{ id: "r1", at: "2026-11-13T23:00:00+09:00", text: "ok", reply_to: uri }] }, NOW).errors.length, 1);
});
