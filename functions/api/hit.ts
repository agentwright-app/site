/**
 * POST /api/hit — cookieless page-view counter for agentwright.app.
 *
 * Every HTML page sends one `navigator.sendBeacon("/api/hit", {p, r, u})` after it has been
 * visible for three seconds (injected by scripts/build-blog.mjs). We store only counters in the
 * `STATS` KV namespace:
 *   - `day:<YYYY-MM-DD>`        one JSON document per day (UTC) with every counter: unique
 *                                visitors, page views per path, new visitors per referring site,
 *                                per `utm_source` and per network operator, and the clicks we care
 *                                about (`buy_click`, `preview_click`) per page
 *   - `v:<YYYY-MM-DD>:<hash>`   "seen today" marker, hash of IP + user agent + date,
 *                                expires after 2 days. No raw IP, no cookie, no email.
 * Days before this version are stored as separate `pv:`, `uv:`, `ref:`, `utm:` and `ev:` keys;
 * `node scripts/stats.mjs` reads both.
 *
 * Not counted: requests that do not come from our own pages, automated clients, cloud hosts, and
 * everything after the day's write budget is spent (lib/stats.ts explains the budget: the free
 * plan's 1,000 KV writes a day are shared with license issuing).
 *
 * Binding: Pages project → Settings → Bindings → KV namespace `STATS`.
 * Without the binding the endpoint does nothing (204), so pages never break.
 */
import { isBotUserAgent, isHostingNetwork, isOwnOrigin, parseHit, recordHit, underMinuteCap } from "../../lib/stats";

interface Env {
  STATS?: KVNamespace;
}

const noContent = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const kv = env.STATS;
  if (!kv) return noContent();
  const ua = request.headers.get("user-agent") ?? "";
  if (isBotUserAgent(ua) || !isOwnOrigin(request.headers.get("origin"))) return noContent();
  const network = String((request.cf as { asOrganization?: unknown } | undefined)?.asOrganization ?? "");
  if (isHostingNetwork(network)) return noContent();

  const hit = parseHit(await request.text());
  if (!hit || !underMinuteCap(Date.now())) return noContent();

  const now = new Date();
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  waitUntil(
    (async () => {
      const visitor = hit.event ? "" : await sha256Hex(`${ip}|${ua}|${now.toISOString().slice(0, 10)}`);
      await recordHit(kv, hit, visitor, network, now);
    })().catch(() => {}),
  );
  return noContent();
};
