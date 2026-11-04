(function () {
  var $ = function (id) { return document.getElementById(id); };
  var DEF = { price: 20, target: 70, feePct: 5, feeFix: 0.5, other: 0.5, model: "claude-sonnet-5-5", req: 300, inp: 4000, out: 600, cache: 60 };
  var ids = Object.keys(DEF);
  var P;
  try { P = JSON.parse($("pricing-data").textContent); } catch (e) { P = null; }
  if (!P || !P.models) fetch("/tools/claude-api-cost-calculator/pricing.json").then(function (r) { return r.json(); }).then(function (j) { P = j; init(); });
  else init();

  function usd(n, d) {
    if (!isFinite(n)) return "—";
    var neg = n < 0; n = Math.abs(n);
    if (d == null) d = n >= 100 ? 0 : 2;
    return (neg ? "−$" : "$") + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function int(n) { return isFinite(n) ? Math.max(0, Math.floor(n)).toLocaleString("en-US") : "—"; }
  function pct(n) { return isFinite(n) ? Math.round(n * 100) + "%" : "—"; }
  function num(id) { var v = parseFloat($(id).value); return isFinite(v) && v >= 0 ? v : 0; }

  function read() {
    var s = {};
    ids.forEach(function (k) { s[k] = k === "model" ? $(k).value : num(k); });
    s.target = Math.min(s.target, 99);
    return s;
  }

  // Cost of one request in USD on model m.
  function reqCost(m, s) {
    var r = m;
    if (m.longPrompt && s.inp > m.longPrompt.thresholdTokens) r = Object.assign({}, m, m.longPrompt);
    var hit = s.cache / 100;
    return (s.inp * (1 - hit) * r.input + s.inp * hit * r.cacheRead + s.out * r.output) / 1e6;
  }

  function calc(m, s, reqs) {
    var per = reqCost(m, s);
    var fees = s.price > 0 ? s.price * s.feePct / 100 + s.feeFix : 0;
    var fixed = fees + s.other;
    var api = per * reqs;
    var profit = s.price - fixed - api;
    var capUsd = s.price * (1 - s.target / 100) - fixed;
    var capReq = per > 0 ? capUsd / per : Infinity;
    return {
      per: per, fees: fees, api: api, profit: profit,
      margin: s.price > 0 ? profit / s.price : NaN,
      breakeven: per > 0 ? (s.price - fixed) / per : Infinity,
      capUsd: capUsd, capReq: capReq,
    };
  }

  function cls(el, v) { el.className = el.className.replace(/\s?(good|bad)/g, "") + (v < 0 ? " bad" : v > 0 ? " good" : ""); }

  function render() {
    var s = read();
    var m = P.models.filter(function (x) { return x.id === s.model; })[0] || P.models[0];
    var r = calc(m, s, s.req);
    $("cacheV").textContent = s.cache + "%";
    $("targetV").textContent = s.target + "%";
    $("modelName").textContent = m.name;
    $("margin").textContent = pct(r.margin);
    cls($("margin"), r.margin);
    $("profit").textContent = usd(r.profit);
    $("api").textContent = usd(r.api);
    $("fees").textContent = usd(r.fees);
    $("perReq").textContent = usd(r.per, 4);
    $("breakeven").textContent = r.breakeven < 0 ? "0" : int(r.breakeven);
    $("capUsd").textContent = r.capUsd < 0 ? "$0.00" : usd(r.capUsd);
    $("capReq").textContent = r.capUsd < 0 ? "0" : int(r.capReq);
    $("capTok").textContent = r.capUsd < 0 ? "0" : int(r.capReq * (s.inp + s.out));
    var head = s.req > 0 && r.capUsd > 0 ? r.capReq / s.req : 0;
    $("headroom").textContent = isFinite(head) ? head.toFixed(1) + "×" : "—";
    cls($("headroom"), head >= 1 ? 1 : -1);

    var w = $("warn"), msg = "";
    if (s.price <= 0) msg = "Enter a plan price above $0 to see a margin.";
    else if (r.capUsd < 0) msg = "Fees and other costs alone exceed what a " + s.target + "% margin allows at this price. Lower the target or raise the price.";
    else if (r.profit < 0) msg = "A typical user costs more than they pay. Raise the price, cache more of the prompt, cut output tokens or use a cheaper model.";
    w.textContent = msg; w.className = "warn" + (msg ? " on" : "");

    var tiers = [["Light (0.3×)", 0.3], ["Typical (1×)", 1], ["Heavy (3×)", 3], ["Power (10×)", 10]];
    $("tiers").innerHTML = tiers.map(function (t) {
      var reqs = Math.round(s.req * t[1]), x = calc(m, s, reqs);
      return "<tr" + (t[1] === 1 ? ' class="sel"' : "") + "><td>" + t[0] + '</td><td class="n">' + int(reqs) + '</td><td class="n">' + usd(x.api) + '</td><td class="n ' + (x.margin < 0 ? "bad" : "") + '">' + pct(x.margin) + "</td></tr>";
    }).join("");
    $("cmp").innerHTML = P.models.map(function (mm) {
      var x = calc(mm, s, s.req);
      return "<tr" + (mm.id === m.id ? ' class="sel"' : "") + "><td>" + mm.name + '</td><td class="n">' + usd(x.api) + '</td><td class="n ' + (x.margin < 0 ? "bad" : "") + '">' + pct(x.margin) + '</td><td class="n">' + (x.capUsd < 0 ? "0" : int(x.capReq)) + "</td></tr>";
    }).join("");

    var q = new URLSearchParams();
    ids.forEach(function (k) { if (String(s[k]) !== String(DEF[k])) q.set(k, s[k]); });
    history.replaceState(null, "", q.toString() ? "?" + q : location.pathname);
  }

  function init() {
    $("model").innerHTML = P.models.map(function (m) { return '<option value="' + m.id + '">' + m.name + "</option>"; }).join("");
    $("updated").textContent = P.updated;
    $("src").href = P.source;
    var q = new URLSearchParams(location.search);
    ids.forEach(function (k) {
      var v = q.has(k) ? q.get(k) : DEF[k];
      if (k === "model" && !P.models.some(function (m) { return m.id === v; })) v = DEF.model;
      $(k).value = v;
    });
    $("f").addEventListener("input", render);
    $("reset").addEventListener("click", function () { ids.forEach(function (k) { $(k).value = DEF[k]; }); render(); });
    $("copy").addEventListener("click", function () {
      var done = function () { $("copied").textContent = "Link copied"; setTimeout(function () { $("copied").textContent = ""; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done, function () { $("copied").textContent = location.href; });
      else $("copied").textContent = location.href;
    });
    render();
  }
})();
