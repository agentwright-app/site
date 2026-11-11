/**
 * GET /api/proof — real social-proof numbers for the landing page (cached 10 min).
 *
 * Only true numbers, and small ones are hidden (null) so the page never shows "0 waiting":
 *   launchLeft   "NN of 50 left" at the launch price. 50 minus live (non-test) licenses ever
 *                issued (refunds don't give discount uses back). Shown only when the Pages
 *                variable SALES_LIVE = "1" AND at least MIN_LAUNCH_SOLD licenses are sold:
 *                "50 of 50 left" only tells a visitor that nobody has bought yet.
 *   buyersMonth  live licenses issued this UTC month, shown when >= MIN_BUYERS.
 *   buyersTotal  all live licenses, shown when >= MIN_BUYERS.
 *   waiting      launch-list signups (WAITLIST `email:*`), shown when >= MIN_WAITING.
 */
interface Env {
  LICENSES?: KVNamespace;
  WAITLIST?: KVNamespace;
  SALES_LIVE?: string;
}

const LAUNCH_LIMIT = 50;
const MIN_LAUNCH_SOLD = 5;
const MIN_BUYERS = 10;
const MIN_WAITING = 20;

async function listAll(kv: KVNamespace, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await kv.list({ prefix, cursor });
    names.push(...r.keys.map((k) => k.name));
    if (r.list_complete) break;
    cursor = r.cursor;
  }
  return names;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/proof", request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let live = 0;
  let month = 0;
  const ym = new Date().toISOString().slice(0, 7);
  if (env.LICENSES) {
    for (const name of await listAll(env.LICENSES, "license:")) {
      const rec = (await env.LICENSES.get(name, "json")) as { testMode?: boolean; createdAt?: string } | null;
      if (!rec || rec.testMode) continue;
      live++;
      if ((rec.createdAt ?? "").startsWith(ym)) month++;
    }
  }
  const waitingCount = env.WAITLIST ? (await listAll(env.WAITLIST, "email:")).length : 0;

  const body = {
    launchLeft: env.SALES_LIVE === "1" && live >= MIN_LAUNCH_SOLD ? Math.max(0, LAUNCH_LIMIT - live) : null,
    buyersMonth: month >= MIN_BUYERS ? month : null,
    buyersTotal: live >= MIN_BUYERS ? live : null,
    waiting: waitingCount >= MIN_WAITING ? waitingCount : null,
  };
  const res = new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=600" },
  });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
};
