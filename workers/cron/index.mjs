// agentwright-cron — Cloudflare Worker with two Cron Triggers: daily 07:00 KST (blog + dev.to) and
// hourly at :07 (X posts from content/x-queue.json, added 2026-11-10).
//
// Why this exists: on 2026-11-10 the unattended Claude routine was refused permission to run
// scripts/devto-crosspost.mjs (and its alert mail), so the Tuesday dev.to cross-post was missed.
// The parts that publish or send mail now run here, with no Claude session in the loop:
//   1. blog check: today's post (KST) is the newest feed item, opens with 200 and is listed on /blog/;
//   2. dev.to: publish at most ONE due post from content/devto-schedule.json (same rules as the script);
//   3. any problem → one "[Agentwright 알림]" mail to 형 via Resend (branded template).
// The 07:17 KST Claude routine only reads public pages/APIs afterwards and reports in the project.
//
// Content is read from the public GitHub repo (main branch), so merged schedule/post changes apply
// without redeploying this worker. Deploy/redeploy: node scripts/deploy-cron-worker.mjs (interactive).
// Secrets (worker secrets, never in code): DEVTO_API_KEY, RESEND_API_KEY, X_API_KEY, X_API_SECRET,
// X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET. KV binding STATE (agentwright-cron-state) remembers posted X ids.
// No fetch handler: not reachable over HTTP.
import { SITE, parse, toDevto } from "./devto-format.mjs";
import { render } from "./render-mail.mjs";

const RAW = "https://raw.githubusercontent.com/agentwright-app/site/main";
const UA = "agentwright-cron/1.0 (+https://agentwright.app)";
const OWNER = "wjdgus071@gmail.com";

const todayKST = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

async function get(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { "user-agent": UA, ...(init.headers ?? {}) } });
  return { status: res.status, ok: res.ok, text: await res.text() };
}

async function checkBlog(today) {
  const feed = await get(`${SITE}/feed.xml`);
  if (!feed.ok) return [`feed.xml 응답 ${feed.status}`];
  const item = feed.text.match(/<item>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<pubDate>([^<]+)<\/pubDate>/);
  if (!item) return ["feed.xml에서 글을 찾지 못했습니다"];
  const [, link, pub] = item;
  const pubDay = new Date(pub).toISOString().slice(0, 10);
  if (pubDay !== today) return [`오늘(${today}) 날짜의 블로그 글이 없습니다. 가장 최근 글은 ${pubDay}입니다(예약 글이 끝났을 수 있습니다).`];
  const problems = [];
  const page = await get(link);
  if (page.status !== 200) problems.push(`오늘 글 ${link} 응답 ${page.status}`);
  const list = await get(`${SITE}/blog/`);
  const path = new URL(link).pathname;
  if (!list.ok || !list.text.includes(path)) problems.push(`Blog(블로그) 목록에 오늘 글(${path})이 없습니다`);
  return problems;
}

async function devto(env, path, init = {}) {
  const res = await fetch(`https://dev.to/api${path}`, {
    ...init,
    headers: { "api-key": env.DEVTO_API_KEY, "content-type": "application/json", accept: "application/vnd.forem.api-v1+json", "user-agent": UA },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`dev.to ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function crosspost(env, today) {
  const sched = await get(`${RAW}/content/devto-schedule.json`);
  if (!sched.ok) throw new Error(`devto-schedule.json 응답 ${sched.status}`);
  const items = JSON.parse(sched.text).filter((i) => i.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!items.length) return "dev.to: 예정된 글 없음";
  const posted = new Set();
  for (let page = 1; page < 10; page++) {
    const list = await devto(env, `/articles/me/all?per_page=100&page=${page}`);
    for (const a of list) if (a.canonical_url) posted.add(a.canonical_url.replace(/#.*$/, ""));
    if (list.length < 100) break;
  }
  for (const item of items) {
    const url = `${SITE}/blog/${item.slug}/`;
    if (posted.has(url)) continue;
    const src = await get(`${RAW}/content/posts/${item.slug}.md`);
    if (!src.ok) throw new Error(`content/posts/${item.slug}.md 응답 ${src.status}`);
    const { meta, body } = parse(src.text);
    if (meta.draft === "true" || meta.date > today) continue;
    const live = await get(url);
    if (live.status !== 200) throw new Error(`${url} 응답 ${live.status}라서 dev.to 게시를 미뤘습니다`);
    const article = { title: meta.title, body_markdown: toDevto(body, url), published: true, canonical_url: url, description: meta.description, tags: (item.tags ?? []).slice(0, 4) };
    const res = await devto(env, "/articles", { method: "POST", body: JSON.stringify({ article }) });
    return `dev.to: published ${item.slug} → ${res.url}`; // one per run, oldest first
  }
  return "dev.to: 예정된 글은 모두 게시됨";
}

async function alert(env, today, problems) {
  await sendAlert(env, `${today} 블로그·dev.to 자동 점검에서 문제가 발견되었습니다`, "매일 07:00(한국시간)에 도는 자동 점검이 아래 문제를 발견했습니다. Claude가 프로젝트에서 이어서 확인하고 고치겠습니다.", problems);
}

async function sendAlert(env, title, intro, problems) {
  const { subject, html, text } = render({
    kind: "alert",
    via: "resend",
    title,
    preheader: problems[0],
    greeting: "형님, 안녕하세요.",
    paragraphs: [intro],
    bullets: problems,
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ from: "Agentwright <hello@agentwright.app>", to: [OWNER], subject, html, text, reply_to: "agentwright.app@gmail.com" }),
  });
  if (!res.ok) console.log(`Resend ${res.status}`);
}

async function run(env) {
  const today = todayKST();
  const problems = [];
  try {
    problems.push(...(await checkBlog(today)));
  } catch (e) {
    problems.push(`블로그 점검 오류: ${e.message}`);
  }
  try {
    console.log(await crosspost(env, today));
  } catch (e) {
    problems.push(`dev.to 게시 실패: ${e.message}`);
  }
  console.log(problems.length ? `problems: ${problems.join(" | ")}` : "all OK");
  if (problems.length) await alert(env, today, problems);
}


// ---------- X (official API v2, OAuth 1.0a user context, pay-per-use) ----------
const X_DAILY = "0 22 * * *";
const X_WINDOW_MS = 3 * 60 * 60 * 1000; // a slot missed by more than 3 hours is skipped, not posted late

const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function oauthHeader(env, method, url) {
  const o = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const base = [method, pct(url), pct(Object.keys(o).sort().map((k) => `${pct(k)}=${pct(o[k])}`).join("&"))].join("&");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${pct(env.X_API_SECRET)}&${pct(env.X_ACCESS_TOKEN_SECRET)}`), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base)));
  o.oauth_signature = btoa(String.fromCharCode(...sig));
  return "OAuth " + Object.keys(o).sort().map((k) => `${pct(k)}="${pct(o[k])}"`).join(", ");
}

async function postToX(env, text) {
  const url = "https://api.x.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: await oauthHeader(env, "POST", url), "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ text }),
  });
  const body = await res.text();
  return { status: res.status, body: body.slice(0, 300) };
}

async function runX(env) {
  if (!env.STATE || !env.X_API_KEY) return console.log("X: not configured");
  const q = await get(`${RAW}/content/x-queue.json`);
  if (!q.ok) return alertX(env, [`x-queue.json 응답 ${q.status}`]);
  const now = Date.now();
  const posts = JSON.parse(q.text).posts ?? [];
  const problems = [];
  for (const p of posts.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const at = Date.parse(p.at);
    if (!(at <= now)) continue;
    if (await env.STATE.get(`x:${p.id}`)) continue;
    if (now - at > X_WINDOW_MS) {
      await env.STATE.put(`x:${p.id}`, JSON.stringify({ skipped: true, reason: "missed window", at: new Date().toISOString() }));
      problems.push(`X 글 ${p.id}(${p.at})는 예정 시각을 3시간 넘겨 건너뛰었습니다.`);
      continue;
    }
    const r = await postToX(env, p.text);
    if (r.status === 201) {
      const id = JSON.parse(r.body).data?.id;
      await env.STATE.put(`x:${p.id}`, JSON.stringify({ tweetId: id, at: new Date().toISOString() }));
      console.log(`X: posted ${p.id} → ${id}`);
    } else {
      await env.STATE.put(`x:${p.id}`, JSON.stringify({ failed: true, status: r.status, at: new Date().toISOString() }));
      problems.push(`X 글 ${p.id} 게시 실패(${r.status}): ${r.body}`);
    }
    break; // at most one post per run
  }
  const left = posts.filter((p) => Date.parse(p.at) > now).length;
  const lowKey = `xlow:${todayKST()}`;
  if (left < 3 && !(await env.STATE.get(lowKey))) {
    await env.STATE.put(lowKey, "1", { expirationTtl: 3 * 86400 });
    problems.push(`X 예약 글이 ${left}개 남았습니다. Claude가 다음 글 묶음을 써야 합니다.`);
  }
  if (problems.length) await alertX(env, problems);
}

async function alertX(env, problems) {
  await sendAlert(env, `${todayKST()} X 자동 게시 알림`, "매시간 도는 X 자동 게시 작업이 아래 내용을 알려 드립니다. Claude가 프로젝트에서 확인하겠습니다.", problems);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === X_DAILY ? run(env) : runX(env));
  },
};
