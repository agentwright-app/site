// public/llms.txt is written by hand. Assistants quote it, so it must not contradict the kit's
// own facts (version, price, stack) that the rest of the site reads from content/kit/meta.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const llms = readFileSync(join(root, "public/llms.txt"), "utf8");
const meta = JSON.parse(readFileSync(join(root, "content/kit/meta.json"), "utf8"));

test("llms.txt names the current kit version and no other", () => {
  assert.match(llms, new RegExp(`version ${meta.version.replace(/\./g, "\\.")}\\b`));
  const versions = [...llms.matchAll(/version (\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(versions)], [meta.version]);
});

test("llms.txt states price, terms and stack the way the site does", () => {
  for (const s of ["$99", "$149", "first 50 licenses", "14-day refund", "Next.js 16", "billing through Polar", "Not included:"])
    assert.ok(llms.includes(s), `llms.txt should mention ${s}`);
  // Polar is the kit's default; Lemon Squeezy is only for developers who already have a store
  // (it accepts no new stores and closes on 2027-03-31). Never offer the two as equal choices.
  assert.equal(/Lemon Squeezy or Polar|Polar or Lemon Squeezy/.test(llms), false);
  assert.ok(llms.includes("already have a Lemon Squeezy store"), "llms.txt should say who the Lemon Squeezy adapter is for");
  assert.equal(/Next\.js 15/.test(llms), false);
  // The launch price has no end date: never state a deadline for it.
  assert.equal(/\buntil\b|\bends on\b|\bdeadline\b/i.test(llms), false);
});

test("llms.txt starts with the H1 and summary blockquote the llms.txt format asks for", () => {
  const lines = llms.split("\n");
  assert.equal(lines[0], "# Agentwright");
  assert.ok(lines[2].startsWith("> "));
});
