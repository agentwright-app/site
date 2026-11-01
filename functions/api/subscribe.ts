/**
 * POST /api/subscribe — launch-list signup for agentwright.app.
 *
 * Cloudflare Pages Function. Stores each address in the `WAITLIST` KV namespace
 * (key `email:<address>`), with light spam protection:
 *   - honeypot field `website` must be empty
 *   - the form must have been open for at least 2 seconds (`ts` field)
 *   - at most 5 signups per IP per hour (KV key `ip:<hash>`, 1h TTL)
 *   - RFC-ish email validation, lowercased, duplicates are idempotent
 *
 * Binding: Pages project → Settings → Bindings → KV namespace `WAITLIST`.
 * Without the binding the endpoint answers 503 and the page shows an email fallback.
 */

interface Env {
  WAITLIST?: KVNamespace;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,24}$/i;
const MAX_PER_IP_PER_HOUR = 5;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let email = "";
  let honeypot = "";
  let openedAt = 0;
  let source = "";

  const ctype = request.headers.get("content-type") ?? "";
  try {
    if (ctype.includes("application/json")) {
      const b = (await request.json()) as Record<string, unknown>;
      email = String(b.email ?? "");
      honeypot = String(b.website ?? "");
      openedAt = Number(b.ts ?? 0);
      source = String(b.source ?? "");
    } else {
      const f = await request.formData();
      email = String(f.get("email") ?? "");
      honeypot = String(f.get("website") ?? "");
      openedAt = Number(f.get("ts") ?? 0);
      source = String(f.get("source") ?? "");
    }
  } catch {
    return json(400, { ok: false, error: "Bad request" });
  }

  // Spam checks. Bots that fill the honeypot or submit instantly get a fake success.
  if (honeypot) return json(200, { ok: true });
  if (openedAt && Date.now() - openedAt < 2000) return json(200, { ok: true });

  email = email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json(400, { ok: false, error: "Please enter a valid email address." });

  if (!env.WAITLIST) {
    return json(503, {
      ok: false,
      error: "Signups are temporarily unavailable. Email hello@agentwright.app and we'll add you by hand.",
    });
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ipKey = `ip:${await sha256Hex(ip)}`;
  const hits = Number((await env.WAITLIST.get(ipKey)) ?? 0);
  if (hits >= MAX_PER_IP_PER_HOUR) {
    return json(429, { ok: false, error: "Too many signups from this network. Try again in an hour." });
  }
  await env.WAITLIST.put(ipKey, String(hits + 1), { expirationTtl: 60 * 60 });

  const key = `email:${email}`;
  const existing = await env.WAITLIST.get(key);
  if (!existing) {
    await env.WAITLIST.put(
      key,
      JSON.stringify({
        email,
        source: source.slice(0, 64) || "landing",
        country: request.headers.get("cf-ipcountry") ?? null,
        referer: request.headers.get("referer") ?? null,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  return json(200, { ok: true, already: Boolean(existing) });
};

/** Health check: GET /api/subscribe → whether the KV binding is present. */
export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  json(200, { ok: true, storage: env.WAITLIST ? "kv" : "missing" });
