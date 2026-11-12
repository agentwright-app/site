// npm test   (no network, no secrets)
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstRun, checkQueue } from "../scripts/check-queues.mjs";

const NOW = Date.parse("2026-11-12T00:00:00+09:00");
const iso = (ms) => new Date(ms).toISOString();

test("firstRun: the first :07 at or after `at`", () => {
  assert.equal(iso(firstRun(Date.parse("2026-11-13T02:30:00+09:00"))), "2026-11-12T18:07:00.000Z"); // 03:07 KST
  assert.equal(iso(firstRun(Date.parse("2026-11-13T02:00:00+09:00"))), "2026-11-12T17:07:00.000Z"); // 02:07 KST
  assert.equal(iso(firstRun(Date.parse("2026-11-13T02:07:00+09:00"))), "2026-11-12T17:07:00.000Z");
});

test("x: an item that really goes out 03:00-07:00 KST is an error", () => {
  const bad = checkQueue("x", { posts: [{ id: "a", at: "2026-11-13T02:30:00+09:00", text: "hi" }] }, NOW);
  assert.equal(bad.errors.length, 1);
  const ok = checkQueue("x", { posts: [{ id: "a", at: "2026-11-13T02:00:00+09:00", text: "hi" }] }, NOW);
  assert.deepEqual(ok.errors, []);
});

test("x: two items in the same hour: the second waits, and may slip into the quiet hours", () => {
  const r = checkQueue("x", { posts: [
    { id: "a", at: "2026-11-13T01:30:00+09:00", text: "one" },
    { id: "b", at: "2026-11-13T02:00:00+09:00", text: "two" },
  ] }, NOW);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.errors.length, 1); // b really goes out at 03:07 KST
});

test("bsky: over 300 graphemes, duplicate ids and a link to a missing post are errors", () => {
  const r = checkQueue("bsky", { posts: [
    { id: "a", at: "2026-11-13T23:00:00+09:00", text: "x".repeat(301) },
    { id: "a", at: "2026-11-14T23:00:00+09:00", text: "ok", link: "https://agentwright.app/blog/no-such-post/" },
  ] }, NOW);
  assert.equal(r.errors.length, 3);
});

test("bsky: the quiet hours are an X rule only", () => {
  const r = checkQueue("bsky", { posts: [{ id: "a", at: "2026-11-13T04:00:00+09:00", text: "ok" }] }, NOW);
  assert.deepEqual(r.errors, []);
});

test("bsky: a link card to someone else's site is a warning (the worker may get a 403 and an empty card)", () => {
  const ext = checkQueue("bsky", { posts: [{ id: "a", at: "2026-11-13T23:00:00+09:00", text: "ok", link: "https://www.producthunt.com/posts/x" }] }, NOW);
  assert.equal(ext.warnings.length, 1);
  assert.deepEqual(ext.errors, []);
  const own = checkQueue("bsky", { posts: [{ id: "a", at: "2026-11-13T23:00:00+09:00", text: "ok", link: "https://agentwright.app/inside/" }] }, NOW);
  assert.deepEqual(own.warnings, []);
});
