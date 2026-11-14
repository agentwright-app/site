/**
 * Visit counting for agentwright.app: the rules of functions/api/hit.ts, kept here without
 * imports so tests/stats-counter.test.mjs can load them.
 *
 * Why it looks like this: the free Cloudflare plan allows 1,000 KV writes a day for the whole
 * account, shared with license issuing (KV `LICENSES`). On 2026-11-13 one crawler loaded every
 * page in a minute through about 100 addresses and used 463 writes. So:
 *   - one JSON document per day (`day:<YYYY-MM-DD>`) holds every counter: a page view costs one
 *     write, a new visitor two (the document and the "seen today" marker). It was 4 to 5 before;
 *   - the document also counts its own writes (`w`). At DAILY_WRITE_CAP counting stops for the
 *     day, which leaves the rest of the 1,000 for licenses, the email list and comments;
 *   - requests that do not come from our own pages, known automated clients and the big cloud
 *     hosts are not counted at all.
 * KV reads can be up to a minute old in another region, so the cap can be passed by a few dozen
 * writes during a burst, and two hits at the same moment can lose one. Fine for traffic numbers.
 */

/** Counting stops for the day (UTC) after this many KV writes by the counter. */
export const DAILY_WRITE_CAP = 400;
/** One running copy of the function counts at most this many hits in a minute. */
export const MINUTE_CAP = 30;

const MAX_KEYS = { pv: 400, ref: 100, utm: 50, ev: 200, net: 100 } as const;

export interface DayDoc {
  /** KV writes the counter made this day. */
  w: number;
  /** Unique visitors. */
  uv: number;
  /** Page views per path. */
  pv: Record<string, number>;
  /** New visitors per referring site, `(direct)` when there was none. */
  ref: Record<string, number>;
  /** New visitors per ?utm_source=. */
  utm: Record<string, number>;
  /** Clicks, keyed `<event>:<path>`. */
  ev: Record<string, number>;
  /** New visitors per network operator, to recognise the next crawler. */
  net: Record<string, number>;
}

export interface Hit {
  path: string;
  referrer: string;
  event: string;
  utm: string;
}

/** The part of KVNamespace the counter uses. */
export interface CounterStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export const EVENTS = new Set(["buy_click", "preview_click"]);

const BOT_UA =
  /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|curl|wget|python|httpclient|facebookexternalhit|embedly|scrapy|scraper|phantomjs|puppeteer|playwright|selenium|go-http|okhttp|axios|node-fetch|undici|libwww|java\/|pingdom|uptime|gtmetrix|pagespeed|ahrefs|semrush|chatgpt|gptbot|claude|anthropic|openai|perplexity|bytedance|datadog|synthetic/i;

/** True for an empty user agent or one that names an automated client. */
export const isBotUserAgent = (ua: string) => !ua || BOT_UA.test(ua);

// Cloud hosts that rent servers. People browse from internet providers, mobile carriers and
// VPNs. Not on this list on purpose: Cloudflare, Akamai and Fastly (iCloud Private Relay leaves
// through them) and the hosts that VPN services use.
const HOSTING =
  /amazon|\baws\b|google llc|google cloud|microsoft|digitalocean|\bovh\b|hetzner|alibaba|tencent|oracle|linode|vultr|contabo|scaleway/i;

/** True when the network operator (Cloudflare's `cf.asOrganization`) is a cloud host. */
export const isHostingNetwork = (org: string) => HOSTING.test(org);

const OWN_HOSTS = new Set(["agentwright.app", "www.agentwright.app", "agentwright.pages.dev"]);

/** A browser sends the page's origin with the beacon. A script calling the endpoint does not. */
export function isOwnOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && OWN_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** Reads the beacon body. Null when it is not JSON or the path is not shaped like one of our pages. */
export function parseHit(raw: string): Hit | null {
  let b: { p?: unknown; r?: unknown; e?: unknown; u?: unknown };
  try {
    b = JSON.parse(raw.slice(0, 2000));
  } catch {
    return null;
  }
  if (!b || typeof b !== "object") return null;
  const path = String(b.p ?? "/") || "/";
  // Only paths shaped like our own pages, so nobody can fill the day's document with made-up keys.
  if (!/^\/[a-z0-9\/._-]{0,120}$/.test(path)) return null;
  const event = String(b.e ?? "");
  if (event && !EVENTS.has(event)) return null;
  return {
    path,
    referrer: String(b.r ?? "").slice(0, 500),
    event,
    utm: String(b.u ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40),
  };
}

/** The referring site without `www.`, `(direct)` when there is none, "" for our own pages. */
export function referrerHost(referrer: string): string {
  if (!referrer) return "(direct)";
  let host = "";
  try {
    host = new URL(referrer).hostname.replace(/^www\./, "").slice(0, 100);
  } catch {}
  if (!host) return "(direct)";
  return host === "agentwright.app" || host === "agentwright.pages.dev" ? "" : host;
}

export const emptyDay = (): DayDoc => ({ w: 0, uv: 0, pv: {}, ref: {}, utm: {}, ev: {}, net: {} });

export function parseDay(raw: string | null): DayDoc {
  const doc = emptyDay();
  if (!raw) return doc;
  try {
    const d = JSON.parse(raw) as Partial<DayDoc>;
    doc.w = Number(d.w) || 0;
    doc.uv = Number(d.uv) || 0;
    for (const k of ["pv", "ref", "utm", "ev", "net"] as const) {
      if (d[k] && typeof d[k] === "object") doc[k] = d[k] as Record<string, number>;
    }
  } catch {}
  return doc;
}

function inc(map: Record<string, number>, key: string, maxKeys: number) {
  if (!key) return;
  if (!(key in map) && Object.keys(map).length >= maxKeys) key = "(other)";
  map[key] = (Number(map[key]) || 0) + 1;
}

/** Adds one hit to the day's document. `isNew`: this visitor was not seen today. */
export function applyHit(doc: DayDoc, hit: Hit, isNew: boolean, network: string): DayDoc {
  if (hit.event) {
    inc(doc.ev, `${hit.event}:${hit.path}`, MAX_KEYS.ev);
    doc.w += 1;
    return doc;
  }
  inc(doc.pv, hit.path, MAX_KEYS.pv);
  if (isNew) {
    doc.uv += 1;
    inc(doc.ref, referrerHost(hit.referrer), MAX_KEYS.ref);
    inc(doc.utm, hit.utm, MAX_KEYS.utm);
    inc(doc.net, network.slice(0, 60) || "(unknown)", MAX_KEYS.net);
  }
  doc.w += isNew ? 2 : 1;
  return doc;
}

const minute = { id: 0, n: 0 };

/** False once this running copy of the function has counted MINUTE_CAP hits in the current minute. */
export function underMinuteCap(nowMs: number): boolean {
  const id = Math.floor(nowMs / 60000);
  if (minute.id !== id) {
    minute.id = id;
    minute.n = 0;
  }
  minute.n += 1;
  return minute.n <= MINUTE_CAP;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Counts one hit. `visitor` is the hash that stands for this visitor today.
 * Returns "capped" without writing when the day's write budget is spent.
 */
export async function recordHit(
  kv: CounterStore,
  hit: Hit,
  visitor: string,
  network: string,
  now: Date = new Date(),
  wait: (ms: number) => Promise<void> = sleep,
): Promise<"counted" | "capped" | "failed"> {
  const day = now.toISOString().slice(0, 10);
  const dayKey = `day:${day}`;
  let isNew: boolean | null = null;
  // KV takes one write a second for a key. A second hit in the same second waits and tries once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const doc = parseDay(await kv.get(dayKey));
      if (doc.w >= DAILY_WRITE_CAP) return "capped";
      if (!hit.event && isNew === null) {
        const seenKey = `v:${day}:${visitor}`;
        isNew = !(await kv.get(seenKey));
        if (isNew) await kv.put(seenKey, "1", { expirationTtl: 172800 });
      }
      await kv.put(dayKey, JSON.stringify(applyHit(doc, hit, isNew === true, network)));
      return "counted";
    } catch {
      if (attempt === 0) await wait(1200);
    }
  }
  return "failed";
}
