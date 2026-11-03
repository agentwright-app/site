/**
 * GET /api/order?order_id=<id>&id=<order_identifier> — license lookup for the /thanks page.
 *
 * Lemon Squeezy redirects buyers to /thanks with `[order_id]` and `[order_identifier]`
 * filled in. The license itself is issued by the signed webhook (see webhooks/lemonsqueezy.ts),
 * which stores the order's UUID identifier with the record. This endpoint only reveals a key
 * when BOTH the numeric order id and that UUID match, so sequential order ids can't be
 * enumerated and no extra API credential is needed on the edge.
 *
 * Responses: 200 {status:"ready", …} · 202 {status:"pending"} (webhook hasn't landed yet)
 *            410 {status:"revoked"} · 400 malformed · 503 storage missing.
 */
import { type LicenseEnv, getLicense } from "../../lib/license";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const onRequestGet: PagesFunction<LicenseEnv> = async ({ request, env }) => {
  if (!env.LICENSES) return json(503, { status: "error", error: "License storage not configured" });

  const url = new URL(request.url);
  const orderId = (url.searchParams.get("order_id") ?? "").trim();
  const identifier = (url.searchParams.get("id") ?? "").trim().toLowerCase();
  if (!/^\d{1,12}$/.test(orderId) || !UUID_RE.test(identifier)) {
    return json(400, { status: "error", error: "Missing or malformed order reference" });
  }

  const key = await env.LICENSES.get(`order:${orderId}`);
  const license = key ? await getLicense(env.LICENSES, key) : null;
  // Unknown order and not-yet-processed order look the same from here; the page retries
  // for a while and then points the buyer at support, so "pending" is the honest answer.
  if (!license) return json(202, { status: "pending" });
  if ((license.orderIdentifier ?? "").toLowerCase() !== identifier) return json(202, { status: "pending" });
  if (license.status !== "active") return json(410, { status: "revoked" });

  return json(200, {
    status: "ready",
    key: license.key,
    downloadUrl: license.downloadUrl,
    email: license.email,
    orderNumber: license.orderNumber,
    testMode: license.testMode,
  });
};
