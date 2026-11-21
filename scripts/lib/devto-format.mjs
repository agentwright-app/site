// Shared by scripts/devto-crosspost.mjs (manual, interactive) and workers/cron (unattended Cloudflare cron).
// Pure string functions: no Node or Workers APIs, so both runtimes can import this file.
export const SITE = "https://agentwright.app";

// DEV Organization the cross-posts are published under (created 2026-11-21, https://dev.to/agentwrightapp).
// dev.to's AI-article guidelines allow a backlink to a company blog only when the post is shared
// under that company's organization on DEV.
export const DEVTO_ORG = "agentwrightapp";

// Organization id, or null when the lookup fails, so the caller still posts as the user (the
// behaviour before the organization existed) instead of skipping the scheduled post.
export async function devtoOrgId(fetchJson) {
  try {
    const org = await fetchJson(`/organizations/${DEVTO_ORG}`);
    return Number.isInteger(org?.id) ? org.id : null;
  } catch {
    return null;
  }
}

export function parse(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("missing frontmatter");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1);
    meta[line.slice(0, i).trim()] = v;
  }
  return { meta, body: m[2] };
}

export function toDevto(body, url) {
  let md = body.replace(/<!-- site-only -->[\s\S]*?<!-- \/site-only -->/g, "");
  // Lede paragraphs are written as HTML for the blog; turn them into Markdown.
  md = md.replace(/<p class="lede">([\s\S]*?)<\/p>/g, (_, inner) =>
    inner.replace(/<a href="([^"]+)">([\s\S]*?)<\/a>/g, "[$2]($1)"),
  );
  // Relative links → absolute (dev.to would resolve them against dev.to).
  md = md.replace(/\]\(\//g, `](${SITE}/`).replace(/href="\//g, `href="${SITE}/`);
  md = md.trimEnd().replace(/\n-{3,}\s*$/, "").trimEnd();
  return `${md}

---

**Questions or corrections?** Please leave them in the [comments on the original post](${url}#comments). We check those every day and answer there, while replies here on DEV can take a while.

*Disclosure: this article was written with the help of AI (Claude). Facts, prices and code were checked against the official documentation and reviewed before publishing.*

*Originally published on the [Agentwright blog](${url}).*
`;
}
