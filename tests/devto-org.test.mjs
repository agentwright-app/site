import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVTO_ORG, devtoOrgId } from "../scripts/lib/devto-format.mjs";

test("devtoOrgId returns the organization id from the lookup", async () => {
  let asked;
  const id = await devtoOrgId(async (path) => {
    asked = path;
    return { id: 12345, username: DEVTO_ORG };
  });
  assert.equal(asked, `/organizations/${DEVTO_ORG}`);
  assert.equal(id, 12345);
});

test("devtoOrgId returns null when the lookup fails or has no id", async () => {
  assert.equal(await devtoOrgId(async () => { throw new Error("404"); }), null);
  assert.equal(await devtoOrgId(async () => ({ error: "not found" })), null);
  assert.equal(await devtoOrgId(async () => null), null);
});
