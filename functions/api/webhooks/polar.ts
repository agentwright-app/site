/**
 * POST /api/webhooks/polar — Polar (polar.sh) webhook receiver. Polar has been the live seller
 * since 2026-11-10: the site's only checkout link goes to Polar. Lemon Squeezy is the dormant
 * backup; its webhook (./lemonsqueezy.ts) is kept and untouched.
 *
 * OFF SWITCH: unless the Pages variable POLAR_ENABLED is exactly "true", every POST answers 503
 * and nothing is written. Polar retries failed deliveries, so an order that arrives while the
 * switch is off is not lost if it is turned back on within Polar's retry window. It must stay
 * "true" while Polar is the live seller.
 *
 * When enabled, verifies the Standard Webhooks signature against POLAR_WEBHOOK_SECRET, then:
 *   order.paid      (Starter product) → issue a license key into KV `LICENSES` (same records,
 *                                       download links and Resend email as Lemon Squeezy orders)
 *   order.refunded  full refund        → mark that order's license as revoked
 *                   partial refund     → acknowledged, license kept
 *   anything else                      → acknowledged and ignored
 *
 * KV order ids are namespaced `polar:<order uuid>` so they can never collide with LS ids.
 *
 * Config (Pages project → Settings → Variables and Secrets):
 *   var POLAR_ENABLED ("true" to turn on), secret POLAR_WEBHOOK_SECRET,
 *   optional var POLAR_PRODUCT_ID (defaults to the Starter product below; other products are ignored),
 *   plus the existing KV LICENSES, LEMONSQUEEZY_WEBHOOK_SECRET (download-link signing) and RESEND_API_KEY.
 */
import {
  type LicenseEnv,
  type LicenseRecord,
  generateLicenseKey,
  getLicense,
  saveLicense,
  signDownloadToken,
  verifyStandardWebhookSignature,
} from "../../../lib/license";
import { type MailEnv, licenseMail, sendMail } from "../../../lib/mail";
import { isFullRefund } from "../../../lib/refund";

type Env = LicenseEnv &
  MailEnv & {
    POLAR_ENABLED?: string;
    POLAR_WEBHOOK_SECRET?: string;
    POLAR_PRODUCT_ID?: string;
  };

interface PolarOrder {
  id?: string;
  status?: string;
  paid?: boolean;
  net_amount?: number;
  total_amount?: number;
  refunded_amount?: number;
  invoice_number?: string | null;
  receipt_number?: string | null;
  checkout_id?: string | null;
  product_id?: string | null;
  billing_name?: string | null;
  customer?: { email?: string | null; name?: string | null };
}

interface PolarEvent {
  type?: string;
  data?: PolarOrder;
}

/** Polar product "Agentwright Starter" ($149 one-time), created 2026-11-10. */
const STARTER_PRODUCT_ID = "fe9c15bd-32a4-4ba9-978c-5a38417a62c6";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** Emails the license to the buyer once; records the outcome on the KV record. */
async function deliverLicense(env: Env, record: LicenseRecord): Promise<LicenseRecord> {
  if (record.emailSent || !record.email) return record;
  const sent = await sendMail(env, record.email, licenseMail(record), {
    idempotencyKey: `license-email-${record.orderId}`,
  });
  const next: LicenseRecord = sent.ok
    ? { ...record, emailSent: true, emailId: sent.id, emailSentAt: new Date().toISOString(), emailError: undefined }
    : { ...record, emailError: sent.error };
  await saveLicense(env.LICENSES!, next);
  return next;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (env.POLAR_ENABLED !== "true") return json(503, { error: "Polar webhook disabled" });
  const secret = env.POLAR_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: "Webhook secret not configured" });
  if (!env.LICENSES || !env.LEMONSQUEEZY_WEBHOOK_SECRET) return json(503, { error: "License storage not configured" });

  const rawBody = await request.text();
  if (!(await verifyStandardWebhookSignature(rawBody, request.headers, secret))) {
    return json(401, { error: "Invalid signature" });
  }

  let event: PolarEvent;
  try {
    event = JSON.parse(rawBody) as PolarEvent;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const type = event.type ?? "";
  const order = event.data ?? {};
  if (!type.startsWith("order.")) return json(200, { ok: true, result: `ignored: ${type}` });
  if (!order.id) return json(400, { error: "Missing data.id" });
  const orderId = `polar:${order.id}`;

  if (type === "order.paid") {
    if (order.product_id !== (env.POLAR_PRODUCT_ID || STARTER_PRODUCT_ID)) {
      return json(200, { ok: true, result: `ignored: product ${order.product_id}` });
    }
    const existingKey = await env.LICENSES.get(`order:${orderId}`);
    if (existingKey) {
      const existing = await getLicense(env.LICENSES, existingKey);
      if (existing && existing.status === "active" && !existing.emailSent) {
        const after = await deliverLicense(env, existing);
        return json(200, { ok: true, result: "already issued", email: after.emailSent ? "sent" : "failed" });
      }
      return json(200, { ok: true, result: "already issued" });
    }

    const key = generateLicenseKey();
    const origin = new URL(request.url).origin;
    const record: LicenseRecord = {
      key,
      status: "active",
      orderId,
      orderNumber: order.invoice_number ?? order.receipt_number ?? null,
      orderIdentifier: order.checkout_id ?? null,
      email: (order.customer?.email ?? "").toLowerCase(),
      name: order.customer?.name ?? order.billing_name ?? null,
      variantId: order.product_id ?? null,
      testMode: false,
      downloadUrl: `${origin}/api/download?token=${encodeURIComponent(
        await signDownloadToken(key, env.LEMONSQUEEZY_WEBHOOK_SECRET),
      )}`,
      emailSent: false,
      createdAt: new Date().toISOString(),
      source: "polar",
    };
    await saveLicense(env.LICENSES, record);
    const after = await deliverLicense(env, record);
    return json(200, { ok: true, result: "license issued", email: after.emailSent ? "sent" : "failed" });
  }

  if (type === "order.refunded") {
    if (!isFullRefund(order)) return json(200, { ok: true, result: "partial refund: license kept" });
    const key = await env.LICENSES.get(`order:${orderId}`);
    const record = key ? await getLicense(env.LICENSES, key) : null;
    if (!record) return json(200, { ok: true, result: "ignored: no license for order" });
    if (record.status !== "revoked") {
      await saveLicense(env.LICENSES, { ...record, status: "revoked", revokedAt: new Date().toISOString() });
    }
    return json(200, { ok: true, result: "license revoked" });
  }

  return json(200, { ok: true, result: `ignored: ${type}` });
};

/** Health check: GET → whether the switch, secret and KV binding are set (never the values). */
export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  json(200, {
    ok: true,
    enabled: env.POLAR_ENABLED === "true",
    secret: env.POLAR_WEBHOOK_SECRET ? "configured" : "missing",
    storage: env.LICENSES ? "kv" : "missing",
    email: env.RESEND_API_KEY ? "configured" : "missing",
  });
