/**
 * POST /api/webhooks/lemonsqueezy — Lemon Squeezy webhook receiver (webhook id 148198).
 *
 * Verifies the `X-Signature` HMAC against LEMONSQUEEZY_WEBHOOK_SECRET, then:
 *   order_created  (Starter variant) → issue a license key, store it in KV `LICENSES`,
 *                                      and attach a signed download link
 *   order_refunded                   → mark that order's license as revoked
 *   anything else                    → acknowledged and ignored
 *
 * Email delivery is not wired yet: each record carries `emailSent: false` so a later
 * job can send the key. Keys are readable via the KV REST API (`license:` prefix).
 *
 * Config (Pages project → Settings → Bindings / Variables and Secrets):
 *   KV LICENSES, secret LEMONSQUEEZY_WEBHOOK_SECRET, var LICENSE_VARIANT_ID.
 */
import {
  type LicenseEnv,
  type LicenseRecord,
  generateLicenseKey,
  getLicense,
  saveLicense,
  signDownloadToken,
  verifyLemonSqueezySignature,
} from "../../../lib/license";

interface WebhookPayload {
  meta?: { event_name?: string; custom_data?: Record<string, unknown> };
  data?: {
    id?: string;
    attributes?: {
      status?: string;
      identifier?: string;
      order_number?: number | string;
      user_email?: string;
      user_name?: string | null;
      test_mode?: boolean;
      first_order_item?: { variant_id?: number | string };
    };
  };
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const onRequestPost: PagesFunction<LicenseEnv> = async ({ request, env }) => {
  const secret = env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: "Webhook secret not configured" });
  if (!env.LICENSES) return json(503, { error: "License storage not configured" });

  const rawBody = await request.text();
  if (!(await verifyLemonSqueezySignature(rawBody, request.headers.get("x-signature"), secret))) {
    return json(401, { error: "Invalid signature" });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const event = payload.meta?.event_name ?? request.headers.get("x-event-name") ?? "";
  const orderId = payload.data?.id ?? "";
  const attrs = payload.data?.attributes ?? {};
  const variantId = attrs.first_order_item?.variant_id != null ? String(attrs.first_order_item.variant_id) : null;

  if (!orderId) return json(400, { error: "Missing data.id" });

  if (event === "order_created") {
    if (env.LICENSE_VARIANT_ID && variantId !== env.LICENSE_VARIANT_ID) {
      return json(200, { ok: true, result: `ignored: variant ${variantId}` });
    }
    const existingKey = await env.LICENSES.get(`order:${orderId}`);
    if (existingKey) return json(200, { ok: true, result: "already issued" });

    const key = generateLicenseKey();
    const origin = new URL(request.url).origin;
    const record: LicenseRecord = {
      key,
      status: "active",
      orderId,
      orderNumber: attrs.order_number != null ? String(attrs.order_number) : null,
      orderIdentifier: attrs.identifier ?? null,
      email: (attrs.user_email ?? "").toLowerCase(),
      name: attrs.user_name ?? null,
      variantId,
      testMode: Boolean(attrs.test_mode),
      downloadUrl: `${origin}/api/download?token=${encodeURIComponent(await signDownloadToken(key, secret))}`,
      emailSent: false,
      createdAt: new Date().toISOString(),
    };
    await saveLicense(env.LICENSES, record);
    return json(200, { ok: true, result: "license issued" });
  }

  if (event === "order_refunded") {
    const key = await env.LICENSES.get(`order:${orderId}`);
    const record = key ? await getLicense(env.LICENSES, key) : null;
    if (!record) return json(200, { ok: true, result: "ignored: no license for order" });
    if (record.status !== "revoked") {
      await saveLicense(env.LICENSES, { ...record, status: "revoked", revokedAt: new Date().toISOString() });
    }
    return json(200, { ok: true, result: "license revoked" });
  }

  return json(200, { ok: true, result: `ignored: ${event}` });
};

/** Health check: GET → whether the secret and KV binding are present. */
export const onRequestGet: PagesFunction<LicenseEnv> = async ({ env }) =>
  json(200, {
    ok: true,
    secret: env.LEMONSQUEEZY_WEBHOOK_SECRET ? "configured" : "missing",
    storage: env.LICENSES ? "kv" : "missing",
  });
