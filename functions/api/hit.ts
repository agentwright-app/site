/**
 * POST /api/hit — cookieless page-view counter for agentwright.app.
 *
 * Every HTML page sends one `navigator.sendBeacon("/api/hit", {p, r})` (injected by
 * scripts/build-blog.mjs). We store only counters in the `STATS` KV namespace:
 *   - `pv:<YYYY-MM-DD>:<path>`  page views of that path that day (UTC)
 *   - `uv:<YYYY-MM-DD>`         unique visitors that day
 *   - `ref:<YYYY-MM-DD>:<host>` new visitors arriving from that external site
 *   - `utm:<YYYY-MM-DD>:<src>`  new visitors arriving with ?utm_source=<src> (listings we submitted)
 *   - `ev:<YYYY-MM-DD>:<event>:<path>`  clicks we care about: `buy_click` (a link to the checkout)
 *                                and `preview_click` (a link to the code preview), per page
 *   - `v:<YYYY-MM-DD>:<hash>`   "seen today" marker, hash of IP + user agent + date,
 *                                expires after 2 days. No raw IP, no cookie, no email.
 * Known bots are ignored. KV counters are best-effort (concurrent hits can lose a count),
 * which is fine for traffic-level decisions. Read totals with `node scripts/stats.mjs`.
 *
 * Binding: Pages project → Settings → Bindings → KV namespace `STATS`.
 * Without the binding the endpoint does nothing (204), so pages never break.
 */

interface Env {
  STATS?: KVNamespace;
}

const BOT_RE = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|curl|wget|python|httpclient|facebookexternalhit|embedly/i;
const EVENTS = new Set(["buy_click", "preview_click"]);
const noContent = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function bump(kv: KVNamespace, key: string): Promise<void> {
  const n = Number((await kv.get(key)) ?? "0") || 0;
  await kv.put(key, String(n + 1));
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const kv = env.STATS;
  if (!kv) return noContent();
  const ua = request.headers.get("user-agent") ?? "";
  if (!ua || BOT_RE.test(ua)) return noContent();

  let path = "/";
  let referrer = "";
  let event = "";
  let utm = "";
  try {
    const b = JSON.parse((await request.text()).slice(0, 2000)) as { p?: unknown; r?: unknown; e?: unknown; u?: unknown };
    path = String(b.p ?? "/").slice(0, 200) || "/";
    referrer = String(b.r ?? "").slice(0, 500);
    event = String(b.e ?? "");
    utm = String(b.u ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
  } catch {
    return noContent();
  }
  if (!path.startsWith("/")) path = "/";

  const day = new Date().toISOString().slice(0, 10);
  if (event) {
    // Click events are counted on their own and never as page views.
    // Only paths shaped like our own pages, so a script cannot fill KV with made-up keys.
    if (EVENTS.has(event) && /^\/[a-z0-9\/._-]{0,120}$/.test(path)) waitUntil(bump(kv, `ev:${day}:${event}:${path}`).catch(() => {}));
    return noContent();
  }
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const work = (async () => {
    await bump(kv, `pv:${day}:${path}`);
    const seenKey = `v:${day}:${await sha256Hex(`${ip}|${ua}|${day}`)}`;
    if (await kv.get(seenKey)) return;
    await kv.put(seenKey, "1", { expirationTtl: 172800 });
    await bump(kv, `uv:${day}`);
    let host = "";
    try {
      host = referrer ? new URL(referrer).hostname.replace(/^www\./, "") : "";
    } catch {}
    if (host && host !== "agentwright.app" && host !== "agentwright.pages.dev") {
      await bump(kv, `ref:${day}:${host.slice(0, 100)}`);
    } else if (!host) {
      await bump(kv, `ref:${day}:(direct)`);
    }
    if (utm) await bump(kv, `utm:${day}:${utm}`);
  })().catch(() => {});
  waitUntil(work);
  return noContent();
};
