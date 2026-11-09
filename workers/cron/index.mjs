// agentwright-cron — Cloudflare Worker with a daily Cron Trigger (07:00 KST).
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
// Secrets (worker secrets, never in code): DEVTO_API_KEY, RESEND_API_KEY. No fetch handler: not reachable over HTTP.
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
  const { subject, html, text } = render({
    kind: "alert",
    via: "resend",
    title: `${today} 블로그·dev.to 자동 점검에서 문제가 발견되었습니다`,
    preheader: problems[0],
    greeting: "형님, 안녕하세요.",
    paragraphs: ["매일 07:00(한국시간)에 도는 자동 점검이 아래 문제를 발견했습니다. Claude가 프로젝트에서 이어서 확인하고 고치겠습니다."],
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

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env));
  },
};
