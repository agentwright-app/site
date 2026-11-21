import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVTO_ORG, DEVTO_ORG_ID, devtoOrgId } from "../scripts/lib/devto-format.mjs";

test("devtoOrgId returns the organization id from the lookup", async () => {
  let asked;
  const id = await devtoOrgId(async (path) => {
    asked = path;
    return { id: 12345, username: DEVTO_ORG };
  });
  assert.equal(asked, `/organizations/${DEVTO_ORG}`);
  assert.equal(id, 12345);
});

test("devtoOrgId falls back to the known id when the lookup fails or has no id", async () => {
  assert.equal(await devtoOrgId(async () => { throw new Error("404"); }), DEVTO_ORG_ID);
  assert.equal(await devtoOrgId(async () => ({ error: "not found" })), DEVTO_ORG_ID);
  assert.equal(await devtoOrgId(async () => null), DEVTO_ORG_ID);
});
