/**
 * Scheduled blog publishing at request time (no deploy needed on publish day).
 *
 * scripts/build-blog.mjs builds every non-draft post and writes:
 *   /_schedule.json            { builtOn, posts: { slug: "YYYY-MM-DD" }, asof: [future publish dates] }
 *   /_asof/<date>/blog/index.html, feed.xml, sitemap.xml   listings as they should look on <date>
 * Here, with "today" in Korea time:
 *   /blog/<slug>/ of a post dated after today            → 404
 *   /blog/, /feed.xml, /sitemap.xml                       → latest snapshot dated on/before today
 *   /_asof/*, /_schedule.json requested from outside      → 404 (internal only)
 * www.agentwright.app/*                               → 301 to agentwright.app (same path)
 * Everything else passes straight through.
 */
interface Schedule {
  builtOn: string;
  posts: Record<string, string>;
  asof: string[];
}

const LISTINGS: Record<string, string> = {
  "/blog": "/blog/",
  "/blog/": "/blog/",
  "/blog/index.html": "/blog/",
  "/feed.xml": "/feed.xml",
  "/sitemap.xml": "/sitemap.xml",
};

export const todayInSeoul = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

export function resolve(path: string, s: Schedule, today: string): { notFound: true } | { rewrite: string } | null {
  const listing = LISTINGS[path];
  if (listing) {
    const day = s.asof.filter((d) => d <= today).pop();
    return day ? { rewrite: `/_asof/${day}${listing}` } : null;
  }
  const m = path.match(/^\/blog\/([a-z0-9-]+)\/?(?:index\.html)?$/);
  if (m && s.posts[m[1]] && s.posts[m[1]] > today) return { notFound: true };
  return null;
}

export const onRequest: PagesFunction<{ ASSETS: Fetcher }> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  // One host for search engines: www.agentwright.app served the same pages as agentwright.app
  // (Search Console counted them as duplicates). Send it to the apex, keeping path and query.
  if (url.hostname === "www.agentwright.app") {
    url.hostname = "agentwright.app";
    return Response.redirect(url.toString(), 301);
  }
  const path = url.pathname;
  if (path.startsWith("/_asof/") || path === "/_schedule.json") return notFound(env, url);
  if (!(path in LISTINGS) && !path.startsWith("/blog/")) return next();

  let schedule: Schedule;
  try {
    const res = await env.ASSETS.fetch(new URL("/_schedule.json", url));
    if (!res.ok) return next();
    schedule = await res.json();
  } catch {
    return next();
  }

  const r = resolve(path, schedule, todayInSeoul());
  if (!r) return next();
  if ("notFound" in r) return notFound(env, url);
  const res = await env.ASSETS.fetch(new URL(r.rewrite, url));
  const headers = new Headers(res.headers);
  // The answer changes at midnight Korea time, so keep shared caches short.
  headers.set("cache-control", "public, max-age=300");
  return new Response(res.body, { status: res.status, headers });
};

async function notFound(env: { ASSETS: Fetcher }, url: URL) {
  const page = await env.ASSETS.fetch(new URL("/404.html", url));
  return new Response(page.body, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
