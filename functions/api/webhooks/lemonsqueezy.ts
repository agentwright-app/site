/**
 * POST /api/webhooks/lemonsqueezy — stable webhook address for the Lemon Squeezy store.
 *
 * The store's webhook points at https://agentwright.app/api/webhooks/lemonsqueezy so the
 * address never changes when the license app moves hosts. This Pages Function forwards the
 * untouched body and the `X-Signature` / `X-Event-Name` headers to the license app
 * (the `starter` repo's app/api/webhooks/lemonsqueezy route), which verifies the HMAC
 * against LEMONSQUEEZY_WEBHOOK_SECRET and issues the license.
 *
 * Config: Pages project → Settings → Environment variables →
 *   LS_WEBHOOK_UPSTREAM = https://<license-app-host>/api/webhooks/lemonsqueezy
 * Until it is set the function answers 503 so Lemon Squeezy records the delivery as failed
 * and the event can be resent from Settings → Webhooks once the app is live.
 */

interface Env {
  LS_WEBHOOK_UPSTREAM?: string;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const upstream = env.LS_WEBHOOK_UPSTREAM;
  if (!upstream) return json(503, { error: "License server not configured (LS_WEBHOOK_UPSTREAM)" });

  const body = await request.text();
  const headers = new Headers({ "content-type": request.headers.get("content-type") ?? "application/json" });
  for (const h of ["x-signature", "x-event-name", "user-agent"]) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }

  try {
    const res = await fetch(upstream, { method: "POST", headers, body });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return json(502, { error: "Upstream unreachable", detail: err instanceof Error ? err.message : String(err) });
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  json(200, { ok: true, upstream: env.LS_WEBHOOK_UPSTREAM ? "configured" : "missing" });
