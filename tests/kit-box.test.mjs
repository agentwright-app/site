// The shared kit box and header Buy button (scripts/lib/kit-box.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { kitBox, withNavBuy, BUY_URL, KIT_TERMS, NAVBUY } from "../scripts/lib/kit-box.mjs";

test("box links to the preview and the one checkout link (both counted by the beacon)", () => {
  const html = kitBox();
  assert.ok(html.includes(`href="/inside/"`));
  assert.ok(html.includes(`href="${BUY_URL}"`));
  assert.match(BUY_URL, /^https:\/\/buy\.polar\.sh\//);
});

test("terms state the real offer and no deadline", () => {
  for (const s of ["$99", "first 50 licenses", "$149", "14-day refund"]) assert.ok(KIT_TERMS.includes(s), s);
  assert.doesNotMatch(KIT_TERMS + kitBox(), /until|ends|left|hurry|only \d+|countdown/i);
});

test("withNavBuy adds the button once and refuses a page without the shared header", () => {
  const page = "<style>a{}</style><header><a class=logo>x</a><nav><a>y</a></nav></header>";
  const once = withNavBuy(page);
  assert.ok(once.includes(`</nav>${NAVBUY}</header>`));
  assert.equal(withNavBuy(once), once);
  assert.throws(() => withNavBuy("<style></style><header>no nav</header>"));
});
