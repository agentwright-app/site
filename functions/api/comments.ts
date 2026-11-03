/**
 * /api/comments — blog comments for agentwright.app.
 *
 * GET  /api/comments?slug=<post-slug>  → published comments for one post (oldest first)
 * POST /api/comments                   → submit a comment {slug, name, body, website (honeypot), ts}
 *
 * Storage: KV namespace `COMMENTS`, one key per comment:
 *   c:<slug>:<createdAtMs>-<id>   JSON CommentRecord
 *   ip:<hash>                     rate-limit counter (10 min TTL)
 *
 * Moderation: comments without links are published at once; comments with a link, or that
 * look like spam, are stored as "pending" and only appear after review. Team replies and
 * moderation are done by writing KV directly with the Cloudflare API (scripts/comments.mjs),
 * so this endpoint has no admin surface and needs no secret.
 */

interface Env {
  COMMENTS?: KVNamespace;
}

export interface CommentRecord {
  id: string;
  slug: string;
  parent: string | null;
  name: string;
  body: string;
  team: boolean;
  status: "published" | "pending" | "hidden";
  createdAt: string;
  country?: string | null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;
const MAX_BODY = 2000;
const MAX_NAME = 60;
const MAX_PER_IP = 3; // per 10 minutes
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|io|xyz|ru|top|info|biz|shop|site)\b)/i;
const SPAM_RE = /\b(casino|viagra|crypto ?airdrop|seo services|backlinks?|escort|loan offer|whatsapp)\b/i;

const json = (status: number, body: unknown, cache = "no-store") =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const publicView = (c: CommentRecord) => ({
  id: c.id,
  parent: c.parent,
  name: c.name,
  body: c.body,
  team: c.team,
  createdAt: c.createdAt,
});

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  if (!SLUG_RE.test(slug)) return json(400, { ok: false, error: "Bad slug" });
  if (!env.COMMENTS) return json(200, { ok: true, comments: [], storage: "missing" });

  const out: CommentRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.COMMENTS.list({ prefix: `c:${slug}:`, cursor });
    const values = await Promise.all(page.keys.map((k) => env.COMMENTS!.get<CommentRecord>(k.name, "json")));
    for (const v of values) if (v && v.status === "published") out.push(v);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < 500);

  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return json(200, { ok: true, comments: out.map(publicView) }, "public, max-age=30");
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, error: "Bad request" });
  }

  const slug = String(b.slug ?? "");
  const name = String(b.name ?? "").replace(/\s+/g, " ").trim();
  const body = String(b.body ?? "").replace(/\r\n/g, "\n").trim();
  const honeypot = String(b.website ?? "");
  const openedAt = Number(b.ts ?? 0);
  const parent = b.parent ? String(b.parent).slice(0, 40) : null;

  // Bots that fill the honeypot or submit within 3 seconds get a fake success.
  if (honeypot) return json(200, { ok: true, status: "published" });
  if (!openedAt || Date.now() - openedAt < 3000) return json(200, { ok: true, status: "published" });

  if (!SLUG_RE.test(slug)) return json(400, { ok: false, error: "Bad slug" });
  if (!name || name.length > MAX_NAME) return json(400, { ok: false, error: `Name is required (max ${MAX_NAME} characters).` });
  if (body.length < 2 || body.length > MAX_BODY) return json(400, { ok: false, error: `Comment must be 2 to ${MAX_BODY} characters.` });
  if (!env.COMMENTS) return json(503, { ok: false, error: "Comments are temporarily unavailable. Email hello@agentwright.app instead." });

  // Only accept comments for posts that exist (the post page must return 200).
  const postUrl = new URL(`/blog/${slug}/`, request.url);
  const check = await fetch(postUrl.toString(), { method: "HEAD" });
  if (!check.ok) return json(400, { ok: false, error: "Unknown post" });

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ipKey = `ip:${await sha256Hex(ip)}`;
  const hits = Number((await env.COMMENTS.get(ipKey)) ?? 0);
  if (hits >= MAX_PER_IP) return json(429, { ok: false, error: "Too many comments from this network. Try again in a few minutes." });
  await env.COMMENTS.put(ipKey, String(hits + 1), { expirationTtl: 600 });

  const suspicious = LINK_RE.test(body) || LINK_RE.test(name) || SPAM_RE.test(body) || SPAM_RE.test(name);
  const now = new Date();
  const id = crypto.randomUUID().slice(0, 8);
  const rec: CommentRecord = {
    id,
    slug,
    parent,
    name,
    body,
    team: false,
    status: suspicious ? "pending" : "published",
    createdAt: now.toISOString(),
    country: request.headers.get("cf-ipcountry") ?? null,
  };
  await env.COMMENTS.put(`c:${slug}:${now.getTime()}-${id}`, JSON.stringify(rec));

  return json(200, { ok: true, status: rec.status, comment: rec.status === "published" ? publicView(rec) : null });
};
