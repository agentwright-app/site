// The one way inner pages point at the kit: a "Buy — $99" button in the header and one compact
// box (one sentence about the kit, the launch terms, "See what's inside" + "Buy — $99").
// Used by every page built with page() in build-blog.mjs, the static tool pages (patched at
// build time) and the pricing, kit and blog templates. The landing page (index.html) has its own.
//
// Clicks are counted by the visit beacon in build-blog.mjs, which listens on the whole document:
// any link to buy.polar.sh → buy_click, any link starting with /inside/ → preview_click, both
// with the page path. New links need no wiring as long as they keep those hrefs.
//
// Every number here must stay true: $99 is the launch price through the LAUNCH discount
// (50 uses, no end date: never add a deadline), list $149, one-time, 14-day refund.

// The only checkout link (Polar, LAUNCH discount attached).
export const BUY_URL = "https://buy.polar.sh/polar_cl_kQukgRtnij2xiJ4WBLHlzBTAmNE8IS6LpGyeg4cFW6n";

export const KIT_TERMS = "<b>$99</b> launch price for the first 50 licenses (list $149) · one-time payment · 14-day refund, no questions asked";

// Default sentence when a page has nothing more specific to say.
export const KIT_ONE_LINE =
  "<strong>Agentwright Starter</strong> is a Next.js 16 codebase for Claude-powered agent SaaS: the agent loop with tools and MCP, per-user cost metering, plan caps, sign-in and billing, already wired together.";

// textHtml is trusted HTML written by us (escape anything that comes from data before passing it).
export const kitBox = (textHtml = KIT_ONE_LINE) =>
  `<aside class="kitbox" aria-label="Agentwright Starter"><p>${textHtml}</p><p class="kitbox-terms">${KIT_TERMS}</p><div class="kitbox-btns"><a class="kb-btn kb-alt" href="/inside/">See what's inside</a><a class="kb-btn" href="${BUY_URL}">Buy — $99</a></div></aside>`;

export const NAVBUY = `<a class="navbuy" href="${BUY_URL}">Buy — $99</a>`;

// Self-contained (only the colour variables every page defines), so the static tool pages can take it too.
export const KITBOX_CSS = `a.navbuy{color:var(--bg);background:var(--primary);padding:7px 13px;border-radius:8px;font-weight:600;font-size:15px;text-decoration:none;white-space:nowrap}
header nav{margin-left:auto}
@media (max-width:560px){header{padding:14px 0}header nav{order:3;width:100%;margin-left:0}}
.kitbox{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:14px;padding:18px 20px;background:var(--card);margin:36px 0;max-width:720px}
.kitbox p{margin:0 0 8px;font-size:16px;line-height:1.55}
.kitbox p.kitbox-terms{color:var(--muted);font-size:14px;margin:0 0 14px}.kitbox-terms b{color:var(--ink)}
.kitbox-btns{display:flex;flex-wrap:wrap;gap:8px}
.kitbox a.kb-btn{display:inline-block;background:var(--primary);color:var(--bg);border:1px solid var(--primary);padding:10px 18px;border-radius:10px;font-weight:600;text-decoration:none;font-size:15px;line-height:1.4}
.kitbox a.kb-btn.kb-alt{background:transparent;color:var(--ink);border-color:var(--line)}
.kitbox.offer h2{font-size:22px;letter-spacing:-.02em;margin:0 0 8px}
.kitbox.offer ul{margin:10px 0 16px;padding-left:20px}.kitbox.offer li{font-size:15.5px;margin:0 0 6px}
.kit-pointer{font-size:15px;color:var(--muted);border-left:3px solid var(--accent);padding:2px 0 2px 12px}.kit-pointer strong{color:var(--ink)}
@media (max-width:560px){.kitbox a.kb-btn{flex:1 1 100%;text-align:center}}`;

// Adds the header button and the CSS to a hand-written page that carries the shared header markup.
export function withNavBuy(html, name = "page") {
  if (html.includes('class="navbuy"')) return html;
  if (!html.includes("</nav></header>") || !html.includes("</style>")) throw new Error(`${name}: no shared header to add the Buy button to`);
  return html.replace("</nav></header>", `</nav>${NAVBUY}</header>`).replace("</style>", `${KITBOX_CSS}\n</style>`);
}
