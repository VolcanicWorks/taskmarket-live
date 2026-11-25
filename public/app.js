/* Taskmarket market visualizer (MIT). Reads data/market.json and data/live.json, written on the server by fetch.py. */
"use strict";
const $ = (s) => document.querySelector(s);
const U = 1e6, CH = { 4217: "Tempo", 8453: "Base" }, TOK = { 4217: "OUSD", 8453: "USDC" };
const C = { base: "#2BB5A6", up: "#4ADE80", pink: "#E63F78", pink2: "#FF8FB5", deep: "#A8245A", cream: "#EFE9E2", paper: "#FFF6E8", sage: "#9FB49A", ash: "#6b6058", mu: "#B0A79D", line: "#453E37" };
const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const money = (b) => { const v = b / U; return v >= 100 ? fmt(v) : v >= 1 ? fmt(v, 1) : fmt(v, 2); };
const usd = (b) => "$" + money(b);
const short = (a) => (a && a.length > 12 ? a.slice(0, 6) + "…" + a.slice(-4) : a || "");
const cleanT = (s) => String(s ?? "").replace(/\\[nr]|[\r\n]+/g, " ").replace(/\s+/g, " ").trim().replace(/^#+\s*/, "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 90 ? Math.round(s) + "s" : s < 5400 ? Math.round(s / 60) + "m" : s < 172800 ? Math.round(s / 3600) + "h" : Math.round(s / 86400) + "d"; };
let M = null, L = null, chain = "4217", range = "30d";
const PANELS = true;  // ledger cards on both sides of the river; the canvas then draws no text labels
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
let NAMES = {};  // wallet -> display name, only as Taskmarket returns it
const nm = (a) => (a && NAMES[a.toLowerCase()]) || short(a);
function addNames() {
  NAMES = Object.assign({}, (M && M.names) || {});
  for (const p of (L && L.payouts) || []) { if (p.posterName) NAMES[p.poster] = p.posterName; if (p.winnerName) NAMES[p.winner] = p.winnerName; }
}
async function getJSON(p) { const r = await fetch(p + "?t=" + Math.floor(Date.now() / 10000), { cache: "no-store" }); if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }
const ease = (t) => 1 - Math.pow(1 - t, 3);

/* ---------------- river ---------------- */
const cv = $("#rv"), X = cv.getContext("2d");
let W = 0, H = 0, P = [], pops = [], live = [], landed = 0;
function fit() { const r = cv.getBoundingClientRect(), k = Math.min(2, devicePixelRatio || 1); cv.width = r.width * k; cv.height = r.height * k; X.setTransform(k, 0, 0, k, 0, 0); W = r.width; H = r.height; }
addEventListener("resize", fit);
const OUT = ["paid", "open", "died"], OC = { paid: C.pink, open: C.sage, died: C.ash }, OL = { paid: "Paid to winners", open: "Still open", died: "Expired or refunded" };
function sum(fl, key, val) { return fl.filter((f) => f[key] === val).reduce((a, f) => a + f.amount, 0); }
function layout() {
  const fl = RVF || (RVF = VD().flows), tot = fl.reduce((a, f) => a + f.amount, 0) || 1;
  const from = [...new Set(fl.map((f) => f.from))].sort((a, b) => (a === "others") - (b === "others") || sum(fl, "from", b) - sum(fl, "from", a));
  const narrow = W < 600, gap = narrow ? 30 : 26, top = narrow ? 44 : 34, avail = H - top - 30;
  const col = (keys, by, x) => { let y = top; const h = avail - gap * (keys.length - 1); return keys.map((k) => { const v = sum(fl, by, k), hh = Math.max(narrow ? 16 : 22, (h * v) / tot); const o = { k, v, x, y, h: hh }; y += hh + gap; return o; }); };
  const lx = narrow ? W * 0.06 : PANELS ? 28 : Math.max(190, W * 0.11), rx = narrow ? W * 0.94 : W - (PANELS || window.RIVER_PANEL ? 28 : Math.max(190, W * 0.11));
  return { tot, fl, L: col(from, "from", lx), R: col(OUT.filter((o) => sum(fl, "to", o) > 0), "to", rx), narrow };
}
const bz = (u, a, b, c, d) => { const i = 1 - u; return i * i * i * a + 3 * i * i * u * b + 3 * i * u * u * c + u * u * u * d; };
function node(lay, side, k) { return (side === "L" ? lay.L : lay.R).find((o) => o.k === k); }
const RV = {};  // animated outcome totals: count up on first view, tick between real values on refresh
function rvVal(key, target, now) {
  let s = RV[key];
  if (!s) s = RV[key] = { from: 0, to: target, t0: now, pulse: 0 };
  else if (s.to !== target) { s.from = s.cur; s.to = target; s.t0 = now; s.pulse = now; }
  const u = RM ? 1 : Math.min(1, (now - s.t0) / 1100);
  s.cur = u >= 1 ? s.to : s.from + (s.to - s.from) * ease(u);
  return { v: s.cur, hot: !RM && s.pulse && now - s.pulse < 900 };
}
function sq(x, y, z) { X.beginPath(); X.roundRect(x - z, y - z, 2 * z, 2 * z, z * 0.35); X.fill(); }
function frame(now) {
  if (!M) return requestAnimationFrame(frame);
  const lay = layout();
  X.fillStyle = "rgba(13,12,10,.22)"; X.fillRect(0, 0, W, H);
  for (const f of lay.fl) {
    const a = node(lay, "L", f.from), b = node(lay, "R", f.to); if (!a || !b) continue;
    const ya = a.y + a.h / 2, yb = b.y + b.h / 2, m = (a.x + b.x) / 2;
    X.strokeStyle = OC[f.to]; X.globalAlpha = 0.06; X.lineWidth = Math.max(2, (f.amount / lay.tot) * (H - 120));
    X.beginPath(); X.moveTo(a.x, ya); X.bezierCurveTo(m, ya, m, yb, b.x, yb); X.stroke();
    if (!RM && Math.random() < (f.amount / lay.tot) * (lay.narrow ? 0.9 : 1.6)) P.push({ a, b, ya: a.y + a.h * (0.2 + 0.6 * Math.random()), yb: b.y + b.h * (0.2 + 0.6 * Math.random()), p: 0, s: 0.0045 + Math.random() * 0.003, k: f.to, z: 1.5 + Math.random() * 1.8, w: Math.random() * 6.3 });
  }
  X.globalAlpha = 1; X.lineWidth = 1;
  for (const q of P) {  // small rounded squares in brand colours; the fading background leaves a soft trail
    q.p += q.s; const e = q.p < 0.5 ? 2 * q.p * q.p : 1 - Math.pow(-2 * q.p + 2, 2) / 2, x0 = q.a.x + 6, x1 = q.b.x - 6, m = (x0 + x1) / 2;
    const x = bz(e, x0, m, m, x1), y = bz(e, q.ya, q.ya, q.yb, q.yb) + Math.sin(q.w + now / 300) * 2;
    X.fillStyle = q.k === "paid" ? (q.z > 2.6 ? C.pink2 : C.pink) : OC[q.k]; X.globalAlpha = q.k === "paid" ? 0.95 : 0.75; sq(x, y, q.z);
    if (q.p >= 1) pops.push({ x: x1, y: q.yb, r: 2, c: OC[q.k], a: 0.5 });
  }
  X.globalAlpha = 1; P = P.filter((q) => q.p < 1);
  for (const c of live) {  // a real payout: its own big square with amount, from its poster to Paid
    c.p = RM ? 1 : Math.min(1, c.p + 0.0042);
    const a = node(lay, "L", c.from) || node(lay, "L", "others"), b = node(lay, "R", "paid"); if (!a || !b) continue;
    const e = c.p < 0.5 ? 2 * c.p * c.p : 1 - Math.pow(-2 * c.p + 2, 2) / 2, x0 = a.x + 6, x1 = b.x - 8, m = (x0 + x1) / 2, ya = a.y + a.h / 2, yb = b.y + b.h / 2;
    const x = bz(e, x0, m, m, x1), y = bz(e, ya, ya, yb, yb) - Math.sin(Math.PI * e) * 30;
    X.shadowColor = C.pink; X.shadowBlur = 26; X.fillStyle = C.pink; sq(x, y, 11); X.shadowBlur = 0; X.fillStyle = C.paper; sq(x, y, 4.5);
    X.font = "11px DM"; const tw = Math.max(X.measureText(c.tag).width, 90) / 2 + 8, lx = Math.max(tw, Math.min(W - tw, x));
    X.font = "600 14px IT"; X.textAlign = "center"; X.fillStyle = C.paper; X.fillText("+" + money(c.amount) + " " + TOK[c.chainId], lx, y - 20);
    X.font = "11px DM"; X.fillStyle = C.mu; X.fillText(c.tag, lx, y + 28);
    if (c.p >= 1 && !c.done) { c.done = 1; landed++; nudgePaid(c); for (let i = 0; i < 3; i++) pops.push({ x: x1, y: yb, r: 4 + i * 8, c: C.pink, a: 1 }); }
  }
  live = live.filter((c) => !c.done);
  for (const p of pops) { p.r += 1.3; p.a *= 0.95; X.strokeStyle = p.c; X.globalAlpha = p.a; X.lineWidth = 1.5; X.beginPath(); X.roundRect(p.x - p.r, p.y - p.r, 2 * p.r, 2 * p.r, p.r * 0.35); X.stroke(); }
  pops = pops.filter((p) => p.a > 0.04); X.globalAlpha = 1; X.lineWidth = 1;
  const lab = (o, side, color) => {
    X.fillStyle = color; X.shadowColor = color; X.shadowBlur = o.k === "paid" ? 14 + 6 * Math.sin(now / 300) : 0;
    X.beginPath(); X.roundRect(side === "L" ? o.x - 8 : o.x, o.y, 8, o.h, 3); X.fill(); X.shadowBlur = 0;
    const name = side === "L" ? (o.k === "others" ? "all other posters" : nm(o.k)) : OL[o.k];
    const val = side === "R" ? rvVal(view + o.k, o.v, now) : { v: o.v, hot: false };
    const inside = lay.narrow; X.textAlign = (side === "L") !== inside ? "right" : "left";
    const tx = side === "L" ? (inside ? o.x + 6 : o.x - 16) : (inside ? o.x - 6 : o.x + 18), ty = inside ? o.y - 4 : o.y + o.h / 2;
    if (PANELS || (side === "R" && window.RIVER_PANEL)) return;
    if (inside) { X.fillStyle = val.hot ? C.pink2 : C.cream; X.font = "600 12px IT"; X.fillText(name + " · " + money(val.v), tx, ty); }
    else { X.fillStyle = C.cream; X.font = "600 13px IT"; X.fillText(name, tx, ty); X.fillStyle = val.hot ? C.pink2 : C.mu; X.font = (val.hot ? "13px" : "12px") + " DM"; X.fillText(money(val.v) + " " + TOK[chain], tx, ty + 16); }
  };
  lay.L.forEach((o) => lab(o, "L", C.cream)); lay.R.forEach((o) => lab(o, "R", OC[o.k]));
  requestAnimationFrame(frame);
}
function launch(p, tag) {
  if (!M) return setTimeout(() => launch(p, tag), 500);
  if (!inView(p.chainId)) return;  // the filter hides other chains' payouts
  const top = VD().flows.some((f) => f.from === p.poster) ? p.poster : "others";
  live.push({ from: top, amount: p.amount, chainId: p.chainId, tag: tag + " · to " + nm(p.winner), p: 0 });
}
/* ---------------- motion helpers ---------------- */
const prev = {};
function tween(from, to, ms, step) {
  if (RM || ms <= 0 || from === to) return step(to);
  const t0 = performance.now();
  (function f(now) { const u = Math.min(1, (now - t0) / ms); step(u >= 1 ? to : from + (to - from) * ease(u)); if (u < 1) requestAnimationFrame(f); })(t0);
}
const FMT = { int: (v) => fmt(Math.round(v)), usd: (v) => usd(v), pct0: (v) => fmt(Math.round(v)) + "%", h: (v) => fmt(v, 1) };
const num = (key, v, f = "int") => `<span class="num" data-key="${key}" data-v="${v}" data-f="${f}">${FMT[f](key in prev ? prev[key] : 0)}</span>`;
function runNums(root) {
  root.querySelectorAll(".num").forEach((el) => {
    const k = el.dataset.key, to = Number(el.dataset.v), f = FMT[el.dataset.f], first = !(k in prev), from = first ? 0 : prev[k], changed = !first && from !== to;
    prev[k] = to;
    tween(from, to, first ? 1200 : changed ? 900 : 0, (v) => (el.textContent = f(to >= 0 && from >= 0 ? Math.max(0, v) : v)));
    if (changed && !RM) { el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse"); }
  });
}
const playFn = {}, obs = {};
// Section animations play whenever the section scrolls into view, and reset when it leaves, so they replay next time.
function whenSeen(sec, fn) {
  playFn[sec.id] = fn;
  if (RM || !("IntersectionObserver" in window)) { sec.classList.add("seen"); return fn(); }
  if (sec.classList.contains("seen")) fn();  // data refreshed while the section is on screen
  if (!obs[sec.id]) {
    obs[sec.id] = new IntersectionObserver((es) => {
      for (const e of es) {
        if (e.isIntersecting) { if (!sec.classList.contains("seen")) { sec.classList.add("seen"); playFn[sec.id] && playFn[sec.id](); } }
        else if (sec.classList.contains("seen")) resetSec(sec);
      }
    }, { threshold: 0.12 });
    obs[sec.id].observe(sec);
  }
}
function resetSec(sec) {
  sec.classList.remove("seen"); sec.classList.add("rs");
  sec.querySelectorAll(".bar .f, .stack i, .tl, .gw").forEach((e) => (e.style.width = "0"));
  sec.querySelectorAll(".gh").forEach((e) => (e.style.height = "0"));
  sec.querySelectorAll(".cols div, .vs div, .vb").forEach((e) => (e.style.height = "0"));
  sec.querySelectorAll(".heatmap i").forEach((e) => { e.style.opacity = "0"; e.style.transform = ""; });
  sec.querySelectorAll(".fg").forEach((e) => (e.style.strokeDashoffset = e.getAttribute("stroke-dasharray")));
  void sec.offsetWidth; sec.classList.remove("rs");
}
function spark(vals, color) {
  const n = vals.length, mx = Math.max(...vals, 1), w = 200, h = 34;
  const d = "M" + vals.map((v, i) => ((i * w) / Math.max(1, n - 1)).toFixed(1) + " " + (h - 3 - (v / mx) * (h - 6)).toFixed(1)).join(" L");
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d} L${w} ${h} L0 ${h}Z" fill="${color}" fill-opacity=".14"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ---------------- sections ---------------- */
function numbers() {
  const ex = EX(), s30 = ex.series["30d"], plat = M.series["30d"], v = VD(), t = M.chains["4217"], b = M.chains["8453"];
  const col = (k, src) => (src || s30).map((r) => Number(r[k] || 0)), tot = (k) => col(k).reduce((a, x) => a + x, 0);
  const wow = (k, avg, src) => {  // last 7 full UTC days vs the 7 before (today is partial, so it is left out)
    const x = col(k, src), a7 = x.slice(-8, -1), b7 = x.slice(-15, -8), f = (y) => y.reduce((p, q) => p + q, 0) / (avg ? y.length || 1 : 1), A = f(a7), B = f(b7);
    if (!B) return "";
    const pc = (100 * (A - B)) / B, up = pc >= 0;
    return `<span class="wow ${up ? "up" : "down"}" tabindex="0" data-tip="${avg ? "Daily average" : "Total"}, last 7 full days vs the 7 days before (UTC)${src ? ", platform-wide" : ""}">${up ? "▲" : "▼"} ${fmt(Math.abs(pc), Math.abs(pc) < 10 ? 1 : 0)}% <em>vs last week</em></span>`;
  };
  const both = view === "both", unitS = both ? "" : `<small class="u">${TOK[view]}</small>`;
  const openCard = sbar("open", M.views["4217"].openNow, M.views["8453"].openNow, (x) => fmt(x));
  const bc = M.views, p30 = (c, k) => ((bc[c] && bc[c].series && bc[c].series["30d"]) || []).reduce((a, r) => a + Number(r[k] || 0), 0);
  const postedBar = bc["4217"] && bc["8453"] ? sbar("posted", p30("4217", "rewardVolume"), p30("8453", "rewardVolume"), (x) => money(x), "Split of rewards posted in 30 days, from the task list (OUSD on Tempo, USDC on Base)") : "";
  const full = (c) => bc[c] && bc[c].settledCoverage[0] >= 0.98 * bc[c].settledCoverage[1];
  const paidBar = full("4217") && full("8453") ? sbar("paid", p30("4217", "paidVolume"), p30("8453", "paidVolume"), (x) => money(x), "Split of rewards paid in 30 days, from payout times (OUSD on Tempo, USDC on Base)") : "";
  $("#big4").innerHTML = [
    `<div class="bn" data-k="open" tabindex="0" data-tip="Open tasks in the task list · ${VNAME()}"><div class="l">Open tasks</div><div class="v">${num("open", v.open)}</div>${wow("tasksCreated").replace("vs last week", "new tasks vs last week")}${openCard}</div>`,
    `<div class="bn" data-k="agents" tabindex="0" data-tip="Agents active in the last 7 days. The API gives this platform-wide only (the same for both chains)."><div class="l">Active agents${both ? "" : " · platform"}</div><div class="v">${num("agents", t.stats.activeAgents7d)}</div>${wow("activeAgents", true, plat)}${spark(col("activeAgents", plat), C.pink)}</div>`,
    `<div class="bn" data-k="posted" tabindex="0" data-tip="Rewards put up in the last 30 days · ${VNAME()} · ${UNIT()}"><div class="l">Posted · 30d</div><div class="v">${num("rp30", tot("rewardVolume"), amtFmt())}${unitS}</div>${wow("rewardVolume")}${spark(col("rewardVolume"), C.pink)}${postedBar}</div>`,
    `<div class="bn" data-k="paid30" tabindex="0" data-tip="Rewards paid to winners in the last 30 days · ${VNAME()} · ${UNIT()}"><div class="l">Paid · 30d</div>${payPartial() ? `<div class="v">–</div><div class="partial">payout history loading · ${payPartial()}%</div>` : `<div class="v">${num("pd30", tot("paidVolume"), amtFmt())}${unitS}</div>${wow("paidVolume")}${spark(col("paidVolume"), C.pink)}${paidBar}`}</div>`,
  ].join("");
  const pair = (k, a, c) => both ? `<span class="pr"><i class="dot t"></i><em>Tempo</em>${num(k + "T", a)}</span><span class="pr"><i class="dot b"></i><em>Base</em>${num(k + "B", c)}</span>` : num(k + view, view === "4217" ? a : c);
  $("#small4").innerHTML = [
    ["Workers paid", pair("pw", t.stats.paidWorkers, b.stats.paidWorkers), "Wallets ever paid · " + VNAME()],
    ["Active wallets", pair("aw", t.stats.activeWallets, b.stats.activeWallets), "Active wallets · " + VNAME()],
    ["Registered workers", num("reg", t.stats.registeredWorkers), "Registered workers (platform-wide)"],
    ["Tasks posted · 30d", num("tp30", tot("tasksCreated")), "Tasks posted in 30 days · " + VNAME()],
  ].map(([l, x, tip]) => `<div class="sm" tabindex="0" data-tip="${tip}"><div class="v">${x}</div><div class="l">${l}</div></div>`).join("") +
    (both ? `<div class="chainkey"><span><i class="dot t"></i>Tempo</span><span><i class="dot b"></i>Base</span><span class="mut">· unmarked = both chains</span></div>` : `<div class="chainkey"><span class="mut">Showing ${CH[view]} only · registered workers and active agents are platform-wide</span></div>`);
  // chain block: split comparison bars per metric (follows the filter)
  $("#small4").innerHTML = (window.chainBlock || chainBlockA)({ t, b, both, view, bc: M.views, tasks30: tot("tasksCreated") });
  whenSeen($("#numbers"), () => { runNums($("#numbers")); (window.chainBlockPlay || grow2)(); });
}
function nudgePaid(c) {  // a real payout landed: nudge the paid number (it changes only on the next data refresh)
  const pc = document.querySelector('#rpanel .lc.paid'); if (pc && !RM) { pc.classList.remove("nudge"); void pc.offsetWidth; pc.classList.add("nudge"); }
  const el = document.querySelector('.bn[data-k="paid30"]'); if (!el || RM) return;
  el.classList.remove("nudge"); void el.offsetWidth; el.classList.add("nudge");
  const chip = document.createElement("span"); chip.className = "chip"; chip.textContent = "+" + money(c.amount) + " " + TOK[c.chainId]; el.appendChild(chip); setTimeout(() => chip.remove(), 2600);
}
function insights() {
  const v = VD(), fl = v.flows, all = fl.reduce((a, f) => a + f.amount, 0) || 1;
  const paid = sum(fl, "to", "paid"), open = sum(fl, "to", "open"), died = sum(fl, "to", "died");
  const top = v.tops.map((p) => `${nm(p.address)}: ${fmt(p.tasks)}`).join("\n");
  const R = 52, CIRC = 2 * Math.PI * R, mp = medianPay(), med = mp.n >= 5 ? mp.m : null;
  const diedN = v.diedTasks, paidN = v.paidTasks, mx = Math.max(diedN, paidN, 1);
  $("#vis4").innerHTML = [
    `<div class="card vi" tabindex="0" data-tip="Top 3 posters (${VNAME()}):\n${esc(top)}\nof ${fmt(v.taskCount)} tasks"><div class="ring"><svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="${R}"/><circle class="fg" cx="60" cy="60" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}" data-off="${CIRC * (1 - v.top3Share / 100)}"/></svg><div class="big">${num("v-conc", v.top3Share, "pct0")}</div></div><div class="c">of tasks come from 3 posters</div></div>`,
    `<div class="card vi" tabindex="0" data-tip="Rewards posted (${UNIT()}): ${amtTxt(all)}\nPaid ${amtTxt(paid)} · open ${amtTxt(open)} · expired or refunded ${amtTxt(died)}"><div class="big p">${num("v-paid", (100 * paid) / all, "pct0")}</div><div class="stack"><i data-w="${(100 * paid) / all}" style="background:${C.pink}"></i><i data-w="${(100 * open) / all}" style="background:${C.sage}"></i><i data-w="${(100 * died) / all}" style="background:${C.ash}"></i></div><div class="legend"><span><i class="dot t"></i>paid</span><span><i class="dot" style="background:${C.sage}"></i>open</span><span><i class="dot" style="background:${C.ash}"></i>died</span></div><div class="c">of rewards paid out</div></div>`,
    `<div class="card vi med" tabindex="0" data-tip="Median hours from posting to payout over the last ${mp.n} payouts seen (${VNAME()})."><div class="big">${med != null ? num("v-med", med, "h") : "–"}<span class="u">hours</span></div><div class="day"><div class="trk"><i class="tl" data-w="${med != null ? Math.min(100, (100 * med) / 24) : 0}"></i></div><div class="ticks"><span>0</span><span>6</span><span>12</span><span>18</span><span>24h</span></div></div><div class="c">${med != null ? "median time to payout" : "too few recent payouts on " + VNAME() + " to say"}</div></div>`,
    `<div class="card vi" tabindex="0" data-tip="Tasks that expired or were cancelled without a winner, vs tasks paid out (${VNAME()})."><div class="dvp"><div class="col"><div class="vs1"><div class="vb" data-h="${(100 * diedN) / mx}" style="background:${C.ash}"></div></div><div class="n">${num("v-died", diedN)}</div><div class="c">died without a winner</div></div><div class="col"><div class="vs1"><div class="vb" data-h="${(100 * paidN) / mx}" style="background:${C.pink}"></div></div><div class="n p">${num("v-paidn", paidN)}</div><div class="c">paid out</div></div></div></div>`,
  ].join("");
  $("#stand-more").innerHTML = `<p>${esc(VNAME().replace(/^b/, "B"))}: ${v.top3Share}% of ${fmt(v.taskCount)} tasks were posted by the 3 busiest of ${fmt(v.posterCount)} posting wallets (${esc(v.tops.map((p) => nm(p.address)).join(", "))}). ${amtTxt(paid)} of ${amtTxt(all)} put up has been paid to winners. Median time from posting to payout: ${med ?? "–"} hours over the last ${mp.n} payouts seen. ${fmt(diedN)} tasks expired or were cancelled without a winner; ${fmt(paidN)} paid out.</p>`;
  whenSeen($("#stand"), () => {
    $("#vis4").querySelectorAll(".fg").forEach((c) => (c.style.strokeDashoffset = c.dataset.off));
    $("#vis4").querySelectorAll(".stack i, .tl").forEach((i) => (i.style.width = i.dataset.w + "%"));
    $("#vis4").querySelectorAll(".vs div, .vb").forEach((d) => (d.style.height = d.dataset.h + "%"));
    runNums($("#stand"));
  });
}
const CK = [["activeAgents", "Active agents", "peak"], ["tasksCreated", "Tasks posted", "total"], ["rewardVolume", "Rewards posted", "total"], ["paidVolume", "Rewards paid", "total"]];
const NPT = 96, curY = {};
function resample(v) { if (v.length < 2) return Array(NPT).fill(v[0] || 0); return Array.from({ length: NPT }, (_, i) => { const x = (i * (v.length - 1)) / (NPT - 1), a = Math.floor(x), b = Math.min(v.length - 1, a + 1); return v[a] + (v[b] - v[a]) * (x - a); }); }
function paths(ys) { const d = "M" + ys.map((y, i) => ((i * 300) / (NPT - 1)).toFixed(1) + " " + (96 - y * 88).toFixed(1)).join(" L"); return [d, d + " L300 100 L0 100Z"]; }
function charts() {
  const ser = (k) => (k === "activeAgents" ? M.series : EX().series)[range], s = ser("tasksCreated"), lab = s.map((r) => r.bucket.slice(5)), box = $("#charts");
  if (!box.dataset.init) {
    box.innerHTML = CK.map(([k, t]) => `<div class="card chart" data-k="${k}"><div class="k">${t}</div><div class="v"></div><svg viewBox="0 0 300 100" preserveAspectRatio="none"><path class="ar" fill="rgba(230,63,120,.14)"/><path class="ln" pathLength="1" fill="none" stroke="${C.pink}" stroke-width="2"/><path class="shm" pathLength="1" fill="none" stroke="${C.paper}" stroke-width="3" stroke-linecap="round"/></svg><div class="axis"><span class="a0"></span><span class="a1"></span></div><div class="tip"></div></div>`).join("");
    box.dataset.init = 1;
    box.querySelectorAll(".chart").forEach((el) => el.querySelector("svg").addEventListener("pointermove", (e) => {
      const k = el.dataset.k, ss = (k === "activeAgents" ? M.series : EX().series)[range], f = k.endsWith("Volume") ? amtTxt : fmt, r = e.currentTarget.getBoundingClientRect();
      const i = Math.max(0, Math.min(ss.length - 1, Math.round(((e.clientX - r.left) / r.width) * (ss.length - 1))));
      el.querySelector(".tip").textContent = ss[i].bucket.slice(5) + " · " + f(Number(ss[i][k]));
    }));
  }
  for (const [k, , kind] of CK) {
    const el = box.querySelector(`.chart[data-k="${k}"]`), v = ser(k).map((r) => Number(r[k] || 0)), mx = Math.max(...v, 1), to = resample(v).map((x) => x / mx);
    const big = kind === "peak" ? Math.max(...v) : v.reduce((a, b) => a + b, 0);
    el.classList.toggle("partial", k === "paidVolume" && !!payPartial());
    if (k === "paidVolume" && payPartial()) { el.querySelector(".v").innerHTML = `– <small>payout history loading · ${payPartial()}%</small>`; curY[k] = to; continue; }
    el.querySelector(".v").innerHTML = num("c-" + k, big, k.endsWith("Volume") ? amtFmt() : "int") + (kind === "peak" ? " <small>peak</small>" : "") + (k.endsWith("Volume") && view !== "both" ? ` <small>${TOK[view]}</small>` : "") + (k === "activeAgents" && view !== "both" ? " <small>platform</small>" : "");
    el.querySelector(".a0").textContent = lab[0] || ""; el.querySelector(".a1").textContent = lab[lab.length - 1] || "";
    const from = curY[k] || to.map(() => 0), ln = el.querySelector(".ln"), ar = el.querySelector(".ar"), shm = el.querySelector(".shm");
    const draw = (u) => { const ys = from.map((y, i) => y + (to[i] - y) * u); const [d, a] = paths(ys); ln.setAttribute("d", d); ar.setAttribute("d", a); shm.setAttribute("d", d); };
    if (!curY[k]) draw(1); else tween(0, 1, 650, draw);
    curY[k] = to;
  }
  whenSeen($("#trends"), () => runNums($("#trends")));
}
const MC = { bounty: "#E63F78", claim: "#FF8FB5", pitch: "#A8245A", benchmark: "#D9A097", auction: "#FFF6E8" };
const SC = { completed: "#E63F78", open: "#9FB49A", claimed: "#FF8FB5", worker_selected: "#D9A097", pending_approval: "#FFF6E8", cancelled: "#6b6058", expired: "#4a423b" };
const lab = (s) => String(s).replace(/_/g, " ");
// Tile fill: 200 tiles per grid, 1 tile = 0.5% of tasks (largest-remainder rounding to exactly 200; tiny groups keep 1 tile).
function waffle(el, title, rows, k, col) {
  const N = 200, t = rows.reduce((a, r) => a + r.count, 0) || 1; rows = rows.slice().sort((a, b) => b.count - a.count);
  const sig = JSON.stringify(rows); if (el.dataset.sig === sig) return; el.dataset.sig = sig;
  const q = rows.map((r) => ({ r, n: Math.max(r.count ? 1 : 0, Math.floor((N * r.count) / t)), f: ((N * r.count) / t) % 1 }));
  let s = q.reduce((a, x) => a + x.n, 0); q.slice().sort((a, b) => b.f - a.f).forEach((x) => { if (s < N) { x.n++; s++; } });
  while (s > N) { const m = q.reduce((a, x) => (x.n > a.n ? x : a)); m.n--; s--; }
  const top = rows[0]; let i = 0;
  el.innerHTML = `<h3>${title}</h3><div class="wcap">${num("w-" + k, Math.round((100 * top.count) / t), "pct0")} <span>are ${esc(lab(top[k]))}</span></div><div class="waffle">` +
    q.map((x) => Array.from({ length: x.n }, () => `<i style="background:${col[x.r[k]] || "#888"};transition-delay:${(i++) * 6}ms" title="${esc(lab(x.r[k]))}: ${fmt(x.r.count)} tasks"></i>`).join("")).join("") +
    `</div><div class="key">${rows.map((r) => `<span tabindex="0" data-tip="${esc(lab(r[k]))}: ${fmt(r.count)} tasks (${fmt((100 * r.count) / t, 1)}%)"><i style="background:${col[r[k]] || "#888"}"></i>${esc(lab(r[k]))} <b>${fmt(r.count)}</b></span>`).join("")}</div>`;
}
function mix() {
  const bd = EX().breakdowns || M.breakdowns;
  waffle($("#modes"), "By mode", bd.mode, "mode", MC);
  waffle($("#statuses"), "By status", bd.status, "status", SC);
  whenSeen($("#mix"), () => runNums($("#mix")));
}
function posters() {
  for (const c of ["4217", "8453"]) {
    $("#pw-" + c).hidden = !inView(c);
    const el = $("#pw-" + c), w = M.views[c].postersPerWeek.slice(-12), mx = Math.max(...w.map((r) => r.posters), 1), last = w[w.length - 1];
    if (!el.dataset.init || el.querySelectorAll(".cols div").length !== w.length) {
      el.innerHTML = `<div class="pwh"><h3><span class="cb ${c === "4217" ? "t" : "b"}">${CH[c].toUpperCase()}</span></h3><span><b class="tw"></b> <span class="mut small">this week</span></span></div><div class="cols">${w.map((_, i) => `<div tabindex="0" style="transition-delay:${i * 60}ms"></div>`).join("")}</div><div class="axis"><span class="a0"></span><span class="a1"></span></div>`;
      el.dataset.init = 1;
    }
    el.querySelector(".tw").innerHTML = num("pw-" + c, last ? last.posters : 0);
    el.querySelector(".a0").textContent = w[0] ? w[0].week.slice(5) : ""; el.querySelector(".a1").textContent = last ? last.week.slice(5) : "";
    el.querySelectorAll(".cols div").forEach((d, i) => { d.className = i === w.length - 1 ? "hi" : ""; d.dataset.tip = `Week of ${w[i].week}: ${w[i].posters} posters`; d.dataset.h = ((100 * w[i].posters) / mx).toFixed(1); });
  }
  whenSeen($("#posters"), () => { document.querySelectorAll("#posters .cols div").forEach((d) => (d.style.height = d.dataset.h + "%")); runNums($("#posters")); });
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function heat() {
  const g = Array.from({ length: 7 }, () => Array(24).fill(0)); let mx = 1;
  for (const c of M.heatmap.cells) { g[+c.row][+c.col] = c.count; mx = Math.max(mx, c.count); }
  const box = $("#heatmap");
  if (!box.dataset.init) {
    let h = "<span></span>" + Array.from({ length: 24 }, (_, i) => `<span>${i % 6 ? "" : i}</span>`).join("");
    for (let d = 0; d < 7; d++) h += `<span>${DAYS[d]}</span>` + Array.from({ length: 24 }, (_, i) => `<i data-d="${d}" data-h="${i}"></i>`).join("");
    box.innerHTML = h; box.dataset.init = 1;
  }
  const now = new Date();
  box.querySelectorAll("i").forEach((el) => { const d = +el.dataset.d, i = +el.dataset.h, v = g[d][i]; el.dataset.o = (0.06 + (0.94 * v) / mx).toFixed(2); el.title = `${DAYS[d]} ${i}:00 UTC · ${v}`; el.style.setProperty("--o", el.dataset.o); el.classList.toggle("now", d === now.getUTCDay() && i === now.getUTCHours()); });
  whenSeen($("#heat"), () => {  // pop each tile in, in a fresh random order every time, straight to its real brightness
    const cells = [...box.querySelectorAll("i")], order = cells.map((_, i) => i).sort(() => Math.random() - 0.5);
    order.forEach((ci, rank) => { const el = cells[ci]; el.style.transitionDelay = RM ? "0ms" : rank * 8 + "ms"; el.style.opacity = el.dataset.o; el.style.transform = "none"; });
  });
}
let seenFeed = new Set();
const TY = { task_submitted: "entry", task_created: "new", task_claimed: "claim", task_rated: "rated" };
function feed(items) {
  const seen = new Set(); items = items.filter((i) => { const k = i.timestamp + i.taskId + i.actor + i.type; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const firstLoad = seenFeed.size === 0;
  for (const c of ["4217", "8453"]) {
    $("#feed-" + c).closest(".card").hidden = !inView(c);
    const rows = items.filter((i) => String(i.chainId) === c).slice(0, 20);
    $("#feed-" + c).innerHTML = rows.length ? rows.map((i, n) => {
      const key = i.timestamp + i.taskId + i.actor + i.type, fresh = !firstLoad && !seenFeed.has(key);
      const who = NAMES[(i.actor || "").toLowerCase()] || (i.actorAgentId ? "agent " + i.actorAgentId : short(i.actor));
      const ty = TY[i.type] || i.type.replace("task_", ""), cls = fresh ? "in fresh" : firstLoad && n < 10 ? "in" : "", st = firstLoad && n < 10 ? ` style="animation-delay:${n * 70}ms"` : "";
      const tip = `${who}${i.amount ? " · " + money(i.amount) + " " + TOK[c] : ""}${i.rating ? " · rating " + i.rating : ""}`;
      return `<li class="${cls}"${st} tabindex="0" data-tip="${esc(tip)}"><span class="ty ${ty === "new" ? "created" : ty}">${esc(ty)}</span><span class="tt">${esc(cleanT(i.taskTitle))}</span><span class="tm">${ago(i.timestamp)}</span></li>`;
    }).join("") : '<li class="mut">No recent activity.</li>';
  }
  items.forEach((i) => seenFeed.add(i.timestamp + i.taskId + i.actor + i.type));
}
// Recent winners conveyor: square pink tiles, newest first; each opens its task page on taskmarket.dev.
const taskURL = (p) => "https://taskmarket.dev/tasks/" + encodeURIComponent(p.taskId);
function tileHTML(p, cls) {
  return `<a class="wt ${cls || ""}" href="${taskURL(p)}" target="_blank" rel="noopener noreferrer" data-tip="${esc((p.code || "") + " " + p.title)}\nfrom ${esc(nm(p.poster))} · paid ${p.hoursToPay} h after posting"><div class="tile"><div class="a">+${money(p.amount)}</div><div class="t">${TOK[p.chainId]}</div></div><div class="who">${esc(nm(p.winner))}</div><div class="ago">${ago(p.settledAt)} ago · ${CH[p.chainId]}</div></a>`;
}
function payoutsList() {
  const ps = payoutsInView(), items = ps.slice(-14).reverse().map((p) => tileHTML(p)).join("");
  $("#track").classList.toggle("empty", !items);
  $("#track").innerHTML = items ? items + items : `<p class="mut empty-msg">No payouts on ${VNAME()} among the latest ${((L && L.payouts) || []).length} seen. New ones appear here as they land.</p>`;
}
function arriveTile(p) {
  if (!inView(p.chainId)) return;
  if (RM) return payoutsList();
  const d = document.createElement("div"); d.innerHTML = tileHTML(p, "enter"); const el = d.firstElementChild; el.querySelector(".tile").classList.add("glow");
  $("#track").prepend(el); setTimeout(payoutsList, 1700);
}
function setChain(c) { setView(c); }
function caption() {
  const v = VD(), tot = v.flows.reduce((a, f) => a + f.amount, 0), paid = sum(v.flows, "to", "paid");
  $("#river-cap").innerHTML = `<b style="color:${C.pink}">${Math.round((100 * paid) / (tot || 1))}%</b> of the ${amtTxt(tot)} posted on ${view === "both" ? "Tempo and Base" : CH[view]} has reached winners. Big squares are real payouts as they happen.`;
}
/* ---------------- refresh ---------------- */
let lastPayout = null, lastLiveCheck = null;
async function loadMarket() {
  M = await getJSON("data/market.json"); addNames();
  const asof = M.asOf.replace("T", " ").replace("Z", " UTC");
  $("#asof").textContent = "data as of " + asof + (M.verifiedAt ? " · verified " + M.verifiedAt.slice(11, 16) + " UTC" : ""); $("#asof2").textContent = "As of " + asof + ".";
  RVF = null; ledgerSig = ""; renderAll(); if (window.riverPanel) window.riverPanel(M, chain);
}
async function loadLive(first) {
  try { L = await getJSON("data/live.json"); } catch (e) { $("#livestat").textContent = "live data unavailable, retrying"; return; }
  addNames(); lastLiveCheck = new Date();
  const sig = (L.payouts || []).length + "|" + ((L.payouts || []).slice(-1)[0] || {}).settledAt + "|" + ((L.feed || [])[0] || {}).timestamp + "|" + (L.feed || []).length;
  const changed = sig !== loadLive.sig; loadLive.sig = sig;
  const ps = L.payouts || [], newest = ps.length ? ps[ps.length - 1].settledAt : null;
  if (first) { const pv = payoutsInView(); if (pv.length) setTimeout(() => launch(pv[pv.length - 1], "latest payout"), 1200); }
  else if (lastPayout) ps.filter((p) => p.settledAt > lastPayout).forEach((p, i) => { p.isNew = 1; setTimeout(() => { launch(p, "new payout"); setTimeout(() => arriveTile(p), 6000); }, i * 1500); });
  if (newest) lastPayout = newest > (lastPayout || "") ? newest : lastPayout;
  if (!first && changed) document.dispatchEvent(new CustomEvent("tm-activity", { detail: { payouts: ps.filter((p) => p.settledAt > (loadLive.prevNewest || "")).length } }));  // used by the header heartbeat
  loadLive.prevNewest = newest;
  if (changed) { feed((L.feed || []).concat(M && M.feedMore ? M.feedMore : [])); payoutsList(); } if (M && L.medianHoursToPay !== loadLive.med) { loadLive.med = L.medianHoursToPay; insights(); }
  $("#livestat").textContent = `Live · every ${L.everySeconds || 10} seconds · checked ${lastLiveCheck.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${landed} landed`;
}
document.querySelectorAll("[data-view-btn]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.viewBtn)));
document.querySelectorAll("#range button").forEach((b) => b.addEventListener("click", () => { range = b.dataset.r; document.querySelectorAll("#range button").forEach((x) => x.classList.toggle("on", x === b)); charts(); }));
document.querySelectorAll(".share").forEach((b) => b.addEventListener("click", async () => {
  const url = location.href.split("#")[0] + "#" + b.dataset.view;
  try { if (navigator.share) await navigator.share({ title: document.title, url }); else { await navigator.clipboard.writeText(url); toast("Link copied"); } } catch (e) { toast(url); }
}));
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (el.hidden = true), 2200); }
(async () => {
  fit(); requestAnimationFrame(frame);
  let tries = 0;
  async function boot() {
    try { await loadLive(!lastPayout); await loadMarket(); }
    catch (e) { $("#asof").textContent = "data could not be loaded, retrying…"; return setTimeout(boot, Math.min(30000, 3000 * ++tries)); }
    (function tick() { setTimeout(async () => { await loadLive(false); tick(); }, ((L && L.everySeconds) || 10) * 1000); })();
    setInterval(() => loadMarket().catch(() => {}), 300000);
  }
  boot();
  setInterval(() => { if (L) { payoutsList(); feed((L.feed || []).concat(M && M.feedMore ? M.feedMore : [])); } }, 30000);  // refresh the "ago" times
})();

/* drawer menu */
(() => {
  const side = $("#side"), scrim = $("#scrim"), btn = $("#burger"); if (!side || !btn) return;
  const set = (open) => { side.classList.toggle("open", open); scrim.hidden = !open; btn.setAttribute("aria-expanded", open); if (open) side.querySelector("nav a").focus(); else btn.focus(); };
  btn.addEventListener("click", () => set(true)); $("#closeside").addEventListener("click", () => set(false)); scrim.addEventListener("click", () => set(false));
  side.querySelectorAll("nav a").forEach((a) => a.addEventListener("click", () => set(false)));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && side.classList.contains("open")) set(false); });
})();

/* ledger cards beside the river: posters (left) and outcomes (right), real per-chain values */
FMT.amt = (v) => money(v);
const OUTS = [["paid", "Paid to winners", C.pink], ["open", "Still open", C.sage], ["died", "Expired or refunded", C.ash]];
let ledgerSig = "";
function ledgers() {
  if (!M || !$("#lpanel")) return;
  const v = VD(), fl = v.flows, tot = fl.reduce((a, f) => a + f.amount, 0) || 1, tok = TOKV();
  const by = (key, x) => fl.filter((f) => f[key] === x).reduce((a, f) => a + f.amount, 0);
  const from = [...new Set(fl.map((f) => f.from))].sort((a, b) => (a === "others") - (b === "others") || by("from", b) - by("from", a));
  const left = from.map((a) => { if (a === "others") return { k: a, l: "All other posters", v: by("from", a), n: v.others.tasks, sub: `${fmt(v.others.wallets)} wallets` };
    const f = v.funders.find((x) => x.address === a) || { tasks: 0 }; return { k: a, l: nm(a), v: by("from", a), n: f.tasks, sub: short(a) }; });
  const right = OUTS.map(([k, l, col]) => ({ k, l, col, v: by("to", k), n: k === "paid" ? v.paidTasks : k === "died" ? v.diedTasks : v.other }));
  const sig = view + JSON.stringify(left.map((x) => [x.k, x.v, x.n])) + JSON.stringify(right.map((x) => [x.v, x.n]));
  if (sig === ledgerSig) return; ledgerSig = sig;
  const f = amtFmt();
  const card = (x, i, side) => `<div class="lc ${side === "R" ? x.k : i < 3 && x.k !== "others" ? "top" : "rest"}"><div class="lb">${side === "R" ? `<i style="background:${x.col}"></i>` : ""}${esc(x.l)}</div>
    <div class="am">${num("lg-" + view + side + x.k, x.v, f)}<small>${tok}</small></div>
    <div class="bar"><i style="background:${side === "R" ? x.col : "linear-gradient(90deg,var(--deep),var(--pink))"}" data-w="${(100 * x.v) / tot}"></i></div>
    <div class="tk">${num("lgp-" + view + side + x.k, (100 * x.v) / tot, "pct0")} of total</div><div class="tk">${fmt(x.n)} tasks</div></div>`;
  $("#lpanel").innerHTML = `<div class="ph">Where it comes from</div>` + left.map((x, i) => card(x, i, "L")).join("");
  $("#rpanel").innerHTML = `<div class="ph">Where it ended up</div>` + right.map((x, i) => card(x, i, "R")).join("");
  runNums($("#river"));
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll("#river .ledger .bar i").forEach((i) => (i.style.width = i.dataset.w + "%"))));
}
/* ---------- kind of work, top posters, entries per task, findings ---------- */
const TCOL = ["#E63F78", "#FF8FB5", "#A8245A", "#D9A097", "#C76B98", "#9FB49A", "#5c5650"];
const grow = (root) => requestAnimationFrame(() => requestAnimationFrame(() => { root.querySelectorAll(".gw").forEach((e) => (e.style.width = e.dataset.w + "%")); root.querySelectorAll(".gh").forEach((e) => (e.style.height = e.dataset.h + "%")); }));
function chg(a, b) { if (!b) return a ? `<span class="wow up">new</span>` : `<span class="wow flat">–</span>`; const p = (100 * (a - b)) / b; return `<span class="wow ${p >= 0 ? "up" : "down"}">${p >= 0 ? "▲" : "▼"} ${fmt(Math.abs(p))}%</span>`; }
function types() {
  const T = EX().types || [], tot = T.reduce((a, t) => a + t.tasks, 0) || 1, wk = T.reduce((a, t) => a + t.thisWeek, 0);
  $("#typebar").innerHTML = T.map((t, i) => `<i class="gw" data-w="${(100 * t.tasks) / tot}" style="background:${TCOL[i % TCOL.length]}" tabindex="0" data-tip="${esc(t.type)}: ${fmt(t.tasks)} tasks (${fmt((100 * t.tasks) / tot, 1)}%)"></i>`).join("");
  $("#typerows").innerHTML = T.map((t, i) => `<div class="trw"><div class="tn"><i style="background:${TCOL[i % TCOL.length]}"></i>${esc(t.type)}</div><div class="tv">${num("ty-" + i, t.tasks)}<small>${fmt((100 * t.tasks) / tot, 0)}%</small></div>
    <div class="twk"><b>${num("tw-" + i, t.thisWeek)}</b> this week ${chg(t.thisWeek, t.lastWeek)}</div><div class="tb"><i class="gw" data-w="${(100 * t.thisWeek) / Math.max(1, ...T.map((x) => x.thisWeek))}" style="background:${TCOL[i % TCOL.length]}"></i></div></div>`).join("");
  $("#typerules").innerHTML = `<p>Each task is matched against these words in its tags and title (whole words; a * matches any ending). The first group that matches wins; tasks with no match are "Other". ${fmt(wk)} tasks were posted in the last 7 days on ${VNAME()}.</p><ul class="small">` + (M.typeRules || []).map(([n, w]) => `<li><b>${esc(n)}:</b> ${esc(w.join(", "))}</li>`).join("") + "</ul>";
  whenSeen($("#types"), () => { runNums($("#types")); grow($("#types")); });
}
function topPosters() {
  const P = EX().posters; if (!P) return;
  const R = 46, CI = 2 * Math.PI * R, f = amtFmt();
  $("#topstat").innerHTML = `<div class="ring sm"><svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="${R}"/><circle class="fg" cx="60" cy="60" r="${R}" stroke-dasharray="${CI}" stroke-dashoffset="${CI}" data-off="${CI * (1 - P.top5RewardShare / 100)}"/></svg><div class="big">${num("t5r", P.top5RewardShare, "pct0")}</div></div>
    <div><div class="tsl">of all rewards on ${VNAME()} came from the <b>top 5 posters</b></div><div class="tss">They also posted ${num("t5n", P.top5TaskShare, "pct0")} of all tasks · ${fmt(P.count)} posting wallets in total</div></div>`;
  const mx = Math.max(...P.top.map((p) => p.reward), 1);
  $("#toptable").innerHTML = `<table class="ptab"><thead><tr><th>#</th><th>Poster</th><th class="r">Tasks</th><th class="r">Rewards</th><th>Share</th></tr></thead><tbody>` +
    P.top.map((p, i) => `<tr class="${i < 5 ? "t5" : ""}"><td class="mono mut">${i + 1}</td><td><span class="pn">${esc(p.name || short(p.address))}</span><span class="pc">${esc(p.chains.join(" · "))}</span></td><td class="r">${num("tp-n" + i, p.tasks)}</td><td class="r">${num("tp-r" + i, p.reward, f)}</td><td class="sh2"><div class="sb"><i class="gw" data-w="${(100 * p.reward) / mx}"></i></div><span>${fmt(p.share, 1)}%</span></td></tr>`).join("") + `</tbody></table><p class="cap" style="margin:10px 0 0">${esc(VNAME().replace(/^b/, "B"))} · rewards in ${UNIT()} · names are Taskmarket display names</p>`;
  whenSeen($("#top"), () => { runNums($("#top")); grow($("#top")); $("#top").querySelectorAll(".fg").forEach((c) => (c.style.strokeDashoffset = c.dataset.off)); });
}
function entries() {
  const E = EX().entries; if (!E) return;
  $("#entstats").innerHTML = [["Median", num("en-med", E.median), "entries per task"], ["Average", num("en-avg", E.mean, "h"), "skewed by a few huge tasks"], ["Top 10%", num("en-p90", E.p90), "get this many or more"], ["Most", num("en-max", E.max), "on a single task"]]
    .map(([l, x, c]) => `<div class="es" tabindex="0" data-tip="${c}"><div class="l">${l}</div><div class="v">${x}</div><div class="c">${c}</div></div>`).join("");
  const mx = Math.max(...E.hist.map((h) => h.tasks), 1);
  $("#enthist").innerHTML = `<div class="hb">` + E.hist.map((h) => `<div class="hc" tabindex="0" data-tip="${fmt(h.tasks)} tasks got ${h.label} entries"><div class="hv"><i class="gh" data-h="${(100 * h.tasks) / mx}"></i></div><span>${h.label}</span></div>`).join("") + `</div><p class="cap" style="margin:6px 0 0;text-align:center">Tasks by number of entries · ${fmt(E.tasks)} tasks, ${VNAME()}</p>`;
  const hm = Math.max(...E.hotOpen.map((h) => h.entries), 1);
  $("#hot").innerHTML = E.hotOpen.length ? E.hotOpen.map((h) => `<li><a href="https://taskmarket.dev/tasks/${encodeURIComponent(h.taskId)}" target="_blank" rel="noopener noreferrer"><span class="ht">${esc(h.title)}</span><span class="hm">${esc(h.code || "")} · ${money(h.reward)} ${TOK[h.chainId]}</span><span class="hbr"><i class="gw" data-w="${(100 * h.entries) / hm}"></i></span><b>${num("hot-" + h.taskId, h.entries)}</b></a></li>`).join("") : `<li class="mut">No open tasks on ${VNAME()} right now.</li>`;
  whenSeen($("#entries"), () => { runNums($("#entries")); grow($("#entries")); });
}
function findings() {
  const v = VD(), ex = EX(), fl = v.flows, all = fl.reduce((a, f) => a + f.amount, 0), paid = sum(fl, "to", "paid"), F = [], where = view === "both" ? "" : ` on ${CH[view]}`;
  const fin = v.paidTasks + v.diedTasks;
  if (fin >= 20 && v.diedTasks) F.push([`1 in ${Math.round(fin / v.diedTasks)}`, `finished tasks${where} ended without a winner (${fmt(v.diedTasks)} expired or cancelled, ${fmt(v.paidTasks)} paid).`]);
  if (v.taskCount >= 20 && all) F.push([`${Math.round((100 * paid) / all)}%`, `of the ${amtTxt(all)} posted${where} has already reached winners.`]);
  if (ex.posters && ex.posters.count >= 10) F.push([`${Math.round(ex.posters.top5RewardShare)}%`, `of all rewards${where} were put up by just 5 of ${fmt(ex.posters.count)} posting wallets.`]);
  const mp = medianPay(); if (mp.n >= 10) F.push([`${mp.m} h`, `is the median time from posting to payout${where} over the last ${fmt(mp.n)} payouts.`]);
  if (ex.entries && ex.entries.tasks >= 30) F.push([`${fmt(ex.entries.median)}`, `entries is what the median task gets${where}; the most contested has ${fmt(ex.entries.max)}.`]);
  const ty = (ex.types || []).filter((x) => x.lastWeek >= 5).map((x) => ({ ...x, g: (x.thisWeek - x.lastWeek) / x.lastWeek })).sort((a, b) => b.g - a.g)[0];
  if (ty && ty.g > 0) F.push([`▲ ${fmt(100 * ty.g)}%`, `more ${ty.type.toLowerCase()} tasks${where} this week than last (${fmt(ty.thisWeek)} vs ${fmt(ty.lastWeek)}).`]);
  const shown = F.slice(0, 5);
  if (shown.length < 3) shown.push(["–", `Too little data${where} for more findings; switch to Both for the full picture.`]);
  $("#findings").innerHTML = shown.map(([k, x], i) => `<li style="--d:${i * 90}ms"><b>${esc(k)}</b><span>${esc(x)}</span></li>`).join("");
}

/* ---------------- page-wide chain filter: Both (default), Tempo, Base ---------------- */
let view = "both";
const VKEY = { both: "both", tempo: "4217", base: "8453" }, VSLUG = { both: "both", 4217: "tempo", 8453: "base" };
const vcs = () => (view === "both" ? ["4217", "8453"] : [view]);
const inView = (c) => vcs().includes(String(c));
const UNIT = () => (view === "both" ? "$ (OUSD + USDC)" : TOK[view]);
const TOKV = () => (view === "both" ? "OUSD + USDC" : TOK[view]);
const VNAME = () => (view === "both" ? "both chains" : CH[view]);
const amtFmt = () => (view === "both" ? "usd" : "amt");
const amtTxt = (b) => (view === "both" ? usd(b) : money(b) + " " + TOK[view]);
function EX() { return M.views[view]; }  // one canonical task set per filter, built on the server (fetch.py build_view)
function VD() {
  const v = M.views[view];
  return { cs: vcs(), flows: v.flows, funders: v.funders, others: v.others, taskCount: v.taskCount, posterCount: v.posterCount,
    paidTasks: v.paidTasks, diedTasks: v.diedTasks, open: v.openNow, other: v.otherTasks, tops: v.top3Tasks, top3Share: v.top3Share };
}
function payoutsInView() { return ((L && L.payouts) || []).filter((p) => inView(p.chainId)); }
function medianPay() { const h = payoutsInView().map((p) => p.hoursToPay).filter((x) => x >= 0).sort((a, b) => a - b); return h.length ? { m: Math.round(10 * h[Math.floor(h.length / 2)]) / 10, n: h.length } : { m: null, n: 0 }; }
function setCaps() { document.querySelectorAll("[data-tpl]").forEach((el) => (el.textContent = el.dataset.tpl.replace("{chain}", VNAME()).replace("{unit}", UNIT()).replace("{plat}", view === "both" ? "" : " · platform-wide (the API does not split this by chain)"))); }
function setView(v, push) {
  view = v; ledgerSig = ""; RVF = null; P = []; live = [];
  document.querySelectorAll("[data-view-btn]").forEach((b) => { const on = b.dataset.viewBtn === v; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  if (push !== false) { const u = new URL(location.href); if (v === "both") u.searchParams.delete("chain"); else u.searchParams.set("chain", VSLUG[v]); history.replaceState(null, "", u); }
  document.body.dataset.view = v;
  if (M) renderAll();
}
function renderAll() { RVF = null; setCaps(); numbers(); findings(); insights(); charts(); mix(); posters(); heat(); caption(); ledgers(); types(); topPosters(); entries(); if (L) { feed((L.feed || []).concat(M.feedMore || [])); payoutsList(); } }
let RVF = null;  // cached river flows for the current filter
{ const q = (new URLSearchParams(location.search).get("chain") || "").toLowerCase(); setView(VKEY[q] || "both", false); }
// Tempo-only / Base-only "paid" figures need every completed task's payout time; until that history is complete they are hidden.
function payPartial() { const c = M.views[view] && M.views[view].settledCoverage; return c && c[1] && c[0] / c[1] < 0.98 ? Math.floor((100 * c[0]) / c[1]) : 0; }
// Proportional Tempo/Base split bar: numbers inside the segments (outside, above, when a segment is too narrow), chain labels below.
function sbar(key, a, b, f, tip) {
  // Proportional Tempo/Base split bar. A number sits inside its segment when it fits; when a segment is too narrow the
  // number moves to the label row under the bar ("Base 186"). Nothing is ever drawn above the bar.
  const one = view !== "both", parts = one ? [[view, view === "4217" ? a : b]] : [["4217", a], ["8453", b]], tot = parts.reduce((s, p) => s + p[1], 0) || 1;
  const fits = (x) => one || ((100 * x) / tot >= 22 && String(f(x)).length * 8 + 12 <= ((100 * x) / tot) * 1.6);
  const seg = parts.map(([c, x]) => `<div class="sg ${c === "4217" ? "t" : "b"}" style="flex:${Math.max(x, tot * 0.04)}">${fits(x) ? `<span>${f(x)}</span>` : ""}</div>`).join("");
  const lab = parts.map(([c, x]) => `<span>${CH[c]}${one ? " only" : ""}${fits(x) ? "" : ` <b>${f(x)}</b>`}</span>`).join("");
  return `<div class="sbar" ${tip ? `data-tip="${esc(tip)}" tabindex="0"` : ""}><div class="sbt">${seg}</div><div class="sbl${one ? " one" : ""}">${lab}</div></div>`;
}

/* chain block (split comparison bars) */
const cbSeries = (x, c, k) => (((x.bc[c] || {}).series || {})["30d"] || []).map((r) => Number(r[k] || 0));
const cbChains = (x) => (x.both ? ["4217", "8453"] : [x.view]);
const cbStat = (x, c) => { const s = (c === "4217" ? x.t : x.b).stats; return { paid: s.paidWorkers, wallets: s.activeWallets, reg: s.registeredWorkers, tasks: cbSeries(x, c, "tasksCreated").reduce((a, v) => a + v, 0) }; };
const grow2 = () => requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll("#small4 [data-w]").forEach((e) => (e.style.width = e.dataset.w + "%"))));
function chainBlockA(x) { document.getElementById("small4").className = "small4 cb2";
  const cs = cbChains(x), st = Object.fromEntries(cs.map((c) => [c, cbStat(x, c)]));
  const row = (k, label) => { const tot = cs.reduce((a, c) => a + st[c][k], 0) || 1;
    return `<div class="cbrow"><div class="cbl">${label}<b>${num("cba" + k + x.view, tot)}</b></div><div class="cbbar">${cs.map((c) => { const pc = (100 * st[c][k]) / tot, ok = cs.length === 1 || pc >= 16; return `<i class="${c === "4217" ? "t" : "b"}" data-w="${Math.max(6, pc)}" title="${CH[c]}: ${fmt(st[c][k])}">${ok ? `${fmt(st[c][k])}<em>${CH[c]} · ${fmt(pc)}%</em>` : ""}</i>`; }).join("")}</div>${cs.some((c) => cs.length > 1 && (100 * st[c][k]) / tot < 16) ? `<div class="cbnote">${cs.map((c) => `<span>${(100 * st[c][k]) / tot < 16 ? `${CH[c]} <b>${fmt(st[c][k])}</b> · ${fmt((100 * st[c][k]) / tot)}%` : ""}</span>`).join("")}</div>` : ""}</div>`; };
  return row("paid", "Workers ever paid") + row("wallets", "Active wallets") + row("tasks", "Tasks posted · 30d") +
    `<div class="cbfoot"><span>Registered workers (platform-wide) <b style="color:var(--cream)">${num("cbareg", st[cs[0]].reg)}</b></span><span><i class="dot t"></i>Tempo <i class="dot b" style="margin-left:10px"></i>Base</span></div>`; }
