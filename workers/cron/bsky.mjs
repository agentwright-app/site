// Bluesky posting for agentwright-cron (added 2026-11-11). Runs in the same hourly :07 trigger as X.
//
// Queue: content/bsky-queue.json on main (same shape as x-queue.json: {paused, posts:[{id, at, text, link?}]}).
// - At most ONE post per run; a slot missed by more than 3 hours is skipped and reported.
// - `link` (optional, https URL): shown as a link card under the post (title/description/image from the
//   page's og: tags). URLs written inside `text` are made clickable with link facets.
// - Bluesky limit: 300 graphemes per post; longer items are refused and reported, never cut.
// Rules followed (atproto bot guide + Bluesky developer guidelines): scheduled posts only; no automated
// follows, likes, reposts, replies or DMs. The profile carries the "bot" self-label (scripts/bsky-profile.mjs).
//
// Secrets: BLUESKY_HANDLE, BLUESKY_APP_PASSWORD (an App Password, never the account password).
// KV STATE keys: bsky:<id> (posted/skipped/failed record), bskylow:<date> (low-queue alert once a day).

const PDS = "https://bsky.social";
const WINDOW_MS = 3 * 60 * 60 * 1000;
const MAX_GRAPHEMES = 300;

export const graphemes = (s) => [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(s)].length;

// Link facets need UTF-8 byte offsets.
export function linkFacets(text) {
  const enc = new TextEncoder();
  const facets = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)\]]+[^\s)\].,!?;:'"]/g)) {
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    facets.push({
      index: { byteStart, byteEnd: byteStart + enc.encode(m[0]).length },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }],
    });
  }
  return facets;
}

const meta = (html, prop) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re);
  const v = m ? m[1] ?? m[2] : "";
  return v.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
};

async function xrpc(method, nsid, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(`${PDS}/xrpc/${nsid}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(raw ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, ok: res.ok, data, text };
}

export async function login(env) {
  const r = await xrpc("POST", "com.atproto.server.createSession", {
    body: { identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD },
  });
  if (!r.ok) throw new Error(`Bluesky 로그인 실패(${r.status}): ${r.data.error ?? ""} ${r.data.message ?? ""}`.trim());
  return { did: r.data.did, token: r.data.accessJwt };
}

async function linkCard(session, url, ua) {
  const page = await fetch(url, { headers: { "user-agent": ua } });
  const html = page.ok ? await page.text() : "";
  const external = {
    uri: url,
    title: meta(html, "og:title") || (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? url),
    description: meta(html, "og:description") || meta(html, "description"),
  };
  const img = meta(html, "og:image");
  if (img) {
    try {
      const pic = await fetch(new URL(img, url), { headers: { "user-agent": ua } });
      const type = pic.headers.get("content-type") ?? "";
      const bytes = await pic.arrayBuffer();
      if (pic.ok && type.startsWith("image/") && bytes.byteLength < 1_000_000) {
        const up = await xrpc("POST", "com.atproto.repo.uploadBlob", { token: session.token, raw: bytes, headers: { "content-type": type } });
        if (up.ok) external.thumb = up.data.blob;
      }
    } catch {}
  }
  return { $type: "app.bsky.embed.external", external };
}

export async function createPost(session, item, ua) {
  const record = { $type: "app.bsky.feed.post", text: item.text, createdAt: new Date().toISOString(), langs: ["en"] };
  const facets = linkFacets(item.text);
  if (facets.length) record.facets = facets;
  if (item.link) record.embed = await linkCard(session, item.link, ua);
  return xrpc("POST", "com.atproto.repo.createRecord", {
    token: session.token,
    body: { repo: session.did, collection: "app.bsky.feed.post", record },
  });
}

// Returns a list of problems (Korean, for the alert mail); never throws.
export async function runBsky(env, { get, raw, ua, today }) {
  if (!env.STATE || !env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) {
    console.log("Bluesky: not configured");
    return [];
  }
  const problems = [];
  try {
    const q = await get(`${raw}/content/bsky-queue.json`);
    if (!q.ok) return [`bsky-queue.json 응답 ${q.status}`];
    const queue = JSON.parse(q.text);
    if (queue.paused) {
      console.log("Bluesky: queue paused");
      return [];
    }
    const now = Date.now();
    const posts = (queue.posts ?? []).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    for (const p of posts) {
      const at = Date.parse(p.at);
      if (!(at <= now)) continue;
      if (await env.STATE.get(`bsky:${p.id}`)) continue;
      if (now - at > WINDOW_MS) {
        await env.STATE.put(`bsky:${p.id}`, JSON.stringify({ skipped: true, reason: "missed window", at: new Date().toISOString() }));
        problems.push(`Bluesky 글 ${p.id}(${p.at})는 예정 시각을 3시간 넘겨 건너뛰었습니다.`);
        continue;
      }
      const n = graphemes(p.text);
      if (n > MAX_GRAPHEMES) {
        await env.STATE.put(`bsky:${p.id}`, JSON.stringify({ failed: true, reason: `too long (${n})`, at: new Date().toISOString() }));
        problems.push(`Bluesky 글 ${p.id}가 ${n}자라 300자 제한을 넘어 올리지 않았습니다.`);
        continue;
      }
      const session = await login(env);
      const r = await createPost(session, p, ua);
      if (r.ok) {
        await env.STATE.put(`bsky:${p.id}`, JSON.stringify({ uri: r.data.uri, at: new Date().toISOString() }));
        console.log(`Bluesky: posted ${p.id} → ${r.data.uri}`);
      } else {
        await env.STATE.put(`bsky:${p.id}`, JSON.stringify({ failed: true, status: r.status, at: new Date().toISOString() }));
        problems.push(`Bluesky 글 ${p.id} 게시 실패(${r.status}): ${r.text.slice(0, 300)}`);
      }
      break; // at most one post per run
    }
    const left = posts.filter((p) => Date.parse(p.at) > now).length;
    const lowKey = `bskylow:${today}`;
    if (left < 3 && !(await env.STATE.get(lowKey))) {
      await env.STATE.put(lowKey, "1", { expirationTtl: 3 * 86400 });
      problems.push(`Bluesky 예약 글이 ${left}개 남았습니다. Claude가 다음 글 묶음을 써야 합니다.`);
    }
  } catch (e) {
    // e.g. login refused: retried every hour until the 3-hour window ends, but mailed once a day.
    const errKey = `bskyerr:${today}`;
    if (!(await env.STATE.get(errKey))) {
      await env.STATE.put(errKey, "1", { expirationTtl: 3 * 86400 });
      problems.push(`Bluesky 자동 게시 오류: ${e.message}`);
    } else console.log(`Bluesky error (already mailed today): ${e.message}`);
  }
  return problems;
}
