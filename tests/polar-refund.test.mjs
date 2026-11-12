// The seller webhook (functions/api/webhooks/polar.ts) revokes a license only for a full refund.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// lib/refund.ts has no imports, so it can be compiled here and loaded as it is. (A direct import
// of a .ts file makes Node warn in this package, which has no "type" in its package.json.)
const source = readFileSync(new URL("../lib/refund.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { isFullRefund } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

// A $99 order with 10% tax: Polar reports refunds without the tax.
const order = { net_amount: 9900, total_amount: 10890 };

test("Polar's status decides whether a refund is full", () => {
  assert.equal(isFullRefund({ ...order, status: "refunded", refunded_amount: 9900 }), true);
  assert.equal(isFullRefund({ ...order, status: "partially_refunded", refunded_amount: 5000 }), false);
  assert.equal(isFullRefund({ ...order, status: "paid", refunded_amount: 0 }), false);
  // Part of the order was paid from the customer's balance: Polar still calls this a partial refund.
  assert.equal(isFullRefund({ ...order, status: "partially_refunded", refunded_amount: 9900 }), false);
  // The status is enough when the amounts are missing.
  assert.equal(isFullRefund({ status: "refunded" }), true);
});

test("without a status, the amount without tax decides", () => {
  assert.equal(isFullRefund({ ...order, refunded_amount: 9900 }), true);
  assert.equal(isFullRefund({ ...order, refunded_amount: 9899 }), false);
  assert.equal(isFullRefund({ total_amount: 9900, refunded_amount: 9900 }), true);
  assert.equal(isFullRefund({ ...order }), false);
  assert.equal(isFullRefund({ net_amount: 0, total_amount: 0, refunded_amount: 0 }), false);
  assert.equal(isFullRefund({}), false);
});
