// "Claude price change alert" signup box, added at build time to pricing pages,
// tools and blog posts. Signups go to /api/subscribe with source "price-alerts:<path>",
// which tags the address with the topic "price-alerts" in the WAITLIST KV.
// Promise on the box: one short email only when Claude API prices change.

export const PRICE_ALERT_MARK = 'id="price-alert"';

export const priceAlertBox = (path) => `<section id="price-alert" style="margin:40px 0 8px;padding:22px 22px 18px;border:1px solid var(--line);border-radius:14px;background:var(--card)">
<h2 style="margin:0 0 6px;font-size:20px;letter-spacing:-.01em">Get an email when Claude API prices change</h2>
<p style="margin:0 0 14px;color:var(--muted);font-size:15px">One short email with the old and new price per million tokens, only when Anthropic changes a price or adds a model. Nothing else. Unsubscribe by replying.</p>
<form id="price-alert-form" action="/api/subscribe" method="post" novalidate style="display:flex;flex-wrap:wrap;gap:8px">
<input type="email" name="email" placeholder="you@company.com" required autocomplete="email" aria-label="Email address" style="flex:1 1 220px;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit;font-size:15px">
<input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
<input type="hidden" name="ts" value="">
<input type="hidden" name="source" value="price-alerts:${path.slice(0, 48)}">
<button type="submit" style="background:var(--primary);color:var(--bg);padding:10px 18px;border-radius:10px;font-weight:600;font-size:15px;border:0;cursor:pointer;font-family:inherit">Alert me</button>
</form>
<p id="price-alert-msg" role="status" aria-live="polite" style="margin:10px 0 0;color:var(--muted);font-size:14px"></p>
<script>
(function(){
var f=document.getElementById('price-alert-form'),m=document.getElementById('price-alert-msg');
f.ts.value=Date.now();
f.addEventListener('submit',function(e){
  e.preventDefault();
  var email=f.email.value.trim();
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){m.textContent='Please enter a valid email address.';return;}
  var btn=f.querySelector('button');btn.disabled=true;m.textContent='Saving\\u2026';
  fetch(f.action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email,website:f.website.value,ts:Number(f.ts.value),source:f.source.value})})
  .then(function(r){return r.json();})
  .then(function(j){
    if(j&&j.ok){m.textContent='Done. We\\u2019ll email you the next time a Claude price changes.';f.email.value='';}
    else{m.innerHTML=(j&&j.error?j.error:'Something went wrong.')+' You can also write to <a href="mailto:hello@agentwright.app" style="color:inherit">hello@agentwright.app</a>.';}
  })
  .catch(function(){m.innerHTML='Network error. Please email <a href="mailto:hello@agentwright.app" style="color:inherit">hello@agentwright.app</a>.';})
  .finally(function(){btn.disabled=false;});
});
})();
</script>
</section>
`;

/** Which built pages get the box: /pricing/claude/**, /tools/<slug>/, /blog/<slug>/. */
export function wantsPriceAlert(urlPath) {
  return /^\/pricing\/claude\//.test(urlPath) || /^\/tools\/[^/]+\/$/.test(urlPath) || /^\/blog\/[^/]+\/$/.test(urlPath);
}
