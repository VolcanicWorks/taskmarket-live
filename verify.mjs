// Data-accuracy checks for the Taskmarket market visualizer (MIT). Node 18+ (global fetch), no dependencies.
// Usage: node verify.mjs --data <site>/data --state <state dir> [--file market.next.json] [--no-api]
// Exit 0 = every check passed (warnings allowed), 1 = at least one FAIL. Writes <state>/verify-last.json.
import { readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg("--data"), STATE = arg("--state"), FILE = arg("--file", "market.next.json"), NOAPI = process.argv.includes("--no-api");
const API = "https://api.taskmarket.dev", UA = { "User-Agent": "taskmarket-market-visualizer/1.0 (read-only; verify)" };
const M = JSON.parse(readFileSync(`${DATA}/${FILE}`, "utf8"));
const T = JSON.parse(readFileSync(`${STATE}/tasks.json`, "utf8"));
const SETT = JSON.parse(readFileSync(`${STATE}/settlements.json`, "utf8"));
const checks = [];
const add = (group, name, status, detail = "") => checks.push({ group, name, status, detail });
const eq = (group, name, a, b, extra = "") => add(group, name, a === b ? "PASS" : "FAIL", a === b ? `${a}` : `${a} ≠ ${b}${extra ? " · " + extra : ""}`);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const VIEWS = { both: T, 4217: T.filter((t) => t.chain === "4217"), 8453: T.filter((t) => t.chain === "8453") };
const outcome = (s) => (s === "completed" ? "paid" : s === "expired" || s === "cancelled" ? "died" : "open");

// 1. Internal consistency: every section of a view adds up to the same canonical task count and money total.
for (const [k, v] of Object.entries(M.views)) {
  const n = v.taskCount, g = `consistency · ${k}`;
  eq(g, "status breakdown = task count", sum(v.breakdowns.status.map((r) => r.count)), n);
  eq(g, "mode breakdown = task count", sum(v.breakdowns.mode.map((r) => r.count)), n);
  eq(g, "kind of work = task count", sum(v.types.map((r) => r.tasks)), n);
  eq(g, "entries per task = task count", v.entries.tasks, n);
  eq(g, "top posters base = task count", v.posters.totalTasks, n);
  eq(g, "paid + died + other = task count", v.paidTasks + v.diedTasks + v.otherTasks, n);
  eq(g, "funders + others = task count", sum(v.funders.map((f) => f.tasks)) + v.others.tasks, n);
  eq(g, "money flows = reward total", sum(v.flows.map((f) => f.amount)), v.rewardTotal);
  eq(g, "funders + others reward = reward total", sum(v.funders.map((f) => f.reward)) + v.others.reward, v.rewardTotal);
  eq(g, "top posters reward base = reward total", v.posters.totalReward, v.rewardTotal);
}
// 2. Tempo + Base = Both.
const [B, Tm, Ba] = [M.views.both, M.views["4217"], M.views["8453"]];
for (const key of ["taskCount", "openNow", "paidTasks", "diedTasks", "otherTasks", "rewardTotal"]) eq("Tempo + Base = Both", key, Tm[key] + Ba[key], B[key]);
for (const s of B.breakdowns.status.map((r) => r.status)) { const c = (v) => (v.breakdowns.status.find((r) => r.status === s) || { count: 0 }).count; eq("Tempo + Base = Both", "status " + s, c(Tm) + c(Ba), c(B)); }
for (const ty of B.types.map((r) => r.type)) { const c = (v) => (v.types.find((r) => r.type === ty) || { tasks: 0 }).tasks; eq("Tempo + Base = Both", "type " + ty, c(Tm) + c(Ba), c(B)); }
add("Tempo + Base = Both", "posting wallets", B.posterCount <= Tm.posterCount + Ba.posterCount && B.posterCount >= Math.max(Tm.posterCount, Ba.posterCount) ? "PASS" : "FAIL", `${B.posterCount} (Tempo ${Tm.posterCount}, Base ${Ba.posterCount})`);

// 3. Independent recompute from the canonical task set (rankings, shares, counts, money).
const rules = M.typeRules.map(([n, ws]) => [n, new RegExp(ws.map((w) => (w.endsWith("*") ? "\\b" + w.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\w*" : "\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b")).join("|"))]);
const kind = (t) => { const hay = (t.tags || []).join(" ").toLowerCase().replace(/-/g, " ") + " | " + (t.title || "").toLowerCase(); for (const [n, rx] of rules) if (rx.test(hay)) return n; return "Other"; };
for (const [k, ts] of Object.entries(VIEWS)) {
  const v = M.views[k], g = `recompute · ${k}`;
  eq(g, "task count", ts.length, v.taskCount);
  eq(g, "open now", ts.filter((t) => t.openNow).length, v.openNow);
  eq(g, "paid tasks", ts.filter((t) => outcome(t.status) === "paid").length, v.paidTasks);
  eq(g, "died tasks", ts.filter((t) => outcome(t.status) === "died").length, v.diedTasks);
  eq(g, "reward total", sum(ts.map((t) => t.reward)), v.rewardTotal);
  const by = new Map(); for (const t of ts) { const b = by.get(t.requester) || { reward: 0, tasks: 0 }; b.reward += t.reward; b.tasks += 1; by.set(t.requester, b); }
  const rank = [...by].sort((a, b) => b[1].reward - a[1].reward || (a[0] < b[0] ? -1 : 1));
  eq(g, "top 3 funders (money flow)", rank.slice(0, 3).map((r) => r[0]).join(","), v.funders.map((f) => f.address).join(","));
  eq(g, "top 10 posters order", rank.slice(0, 10).map((r) => r[0]).join(","), v.posters.top.map((p) => p.address).join(","));
  const r1 = (x) => Math.round(x * 10) / 10, tot = sum(ts.map((t) => t.reward)) || 1;
  eq(g, "top 5 reward share %", r1((100 * sum(rank.slice(0, 5).map((r) => r[1].reward))) / tot), v.posters.top5RewardShare);
  eq(g, "top 5 task share % (same 5 posters)", r1((100 * sum(rank.slice(0, 5).map((r) => r[1].tasks))) / Math.max(1, ts.length)), v.posters.top5TaskShare);
  const e = ts.map((t) => t.submissionCount).sort((a, b) => a - b), q = (f) => e[Math.min(e.length - 1, Math.floor(f * (e.length - 1) + 0.5))];
  eq(g, "entries median", q(0.5), v.entries.median); eq(g, "entries max", e[e.length - 1], v.entries.max);
  const kc = {}; for (const t of ts) kc[kind(t)] = (kc[kind(t)] || 0) + 1;
  eq(g, "kind of work split", JSON.stringify(Object.fromEntries(v.types.map((r) => [r.type, r.tasks]))), JSON.stringify(Object.fromEntries(v.types.map((r) => [r.type, kc[r.type] || 0]))));
}
// 4. Sanity: no NaN, Infinity, negative numbers or escape text anywhere the page reads.
let L = null; try { L = JSON.parse(readFileSync(`${DATA}/live.json`, "utf8")); } catch {}
const bad = [];
const walk = (o, path) => {
  if (typeof o === "number") { if (!Number.isFinite(o)) bad.push(`${path} not a number`); else if (o < 0) bad.push(`${path} negative (${o})`); }
  else if (typeof o === "string") { if (/^(title|taskTitle)$/.test(path.split(".").pop()) && (/\\n|\\r|\n|\r/.test(o) || /^#+\s/.test(o))) bad.push(`${path} escape text or markdown: ${JSON.stringify(o.slice(0, 40))}`); if (/^(NaN|undefined|null)$/.test(o)) bad.push(`${path} = "${o}"`); }
  else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${path}[${i}]`));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
};
walk(M.views, "views"); walk(M.feed, "feed"); walk(M.feedMore, "feedMore"); if (L) walk(L, "live");
const requiredNums = ["taskCount", "openNow", "paidTasks", "diedTasks", "otherTasks", "rewardTotal", "posterCount"];
for (const [k, v] of Object.entries(M.views)) for (const f of requiredNums) if (typeof v[f] !== "number") bad.push(`views.${k}.${f} missing or null`);
add("sanity", "no NaN, null, negative or escape text", bad.length ? "FAIL" : "PASS", bad.length ? bad.slice(0, 5).join(" | ") + (bad.length > 5 ? ` (+${bad.length - 5} more)` : "") : "all values clean");

// 5. Reconcile with a fresh read of the live Taskmarket API.
const get = async (p) => { const r = await fetch(API + p, { headers: UA }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };
if (!NOAPI) {
  try {
    // The market moves while the lists are read, so each figure must lie inside Taskmarket's own totals taken just before
    // and just after the fetch (exact when nothing changed). If it does not, compare once more with a fresh read.
    const W = M.apiWindow || {}, st = await get("/api/market/stats?chainId=4217");
    const inWin = (ours, a, b) => a !== undefined && b !== undefined && ours >= Math.min(a, b) && ours <= Math.max(a, b);
    const winTxt = (a, b, now) => (a === b ? `API ${a}` : `API ${a} before, ${b} after the fetch`) + (now !== undefined ? `, ${now} now` : "");
    {
      const a = W.before && W.before.openTasks, b = W.after && W.after.openTasks, ok = inWin(B.openNow, a, b) || B.openNow === st.openTasks;
      add("API reconcile", "open tasks = Taskmarket openTasks", ok ? "PASS" : "FAIL", `${B.openNow} · ${winTxt(a, b, st.openTasks)}`);
    }
    const bd = await get("/api/stats/breakdowns?chainId=4217"), ours = Object.fromEntries(B.breakdowns.status.map((r) => [r.status, r.count]));
    let gap = 0;
    for (const r of bd.status) {
      const o = ours[r.status] || 0, a = W.before && W.before.status[r.status], b = W.after && W.after.status[r.status];
      if (o === r.count || inWin(o, a, b)) add("API reconcile", `status ${r.status}`, "PASS", `${o} · ${winTxt(a, b, r.count)}`);
      else if (["open", "worker_selected"].includes(r.status) && o < Math.min(r.count, b ?? r.count)) { const g = Math.min(r.count, b ?? r.count) - o; gap += g; add("API reconcile", `status ${r.status}`, "WARN", `${o} listed vs ${winTxt(a, b, r.count)}: ${g} not in any public task list`); }
      else add("API reconcile", `status ${r.status}`, "FAIL", `${o} · ${winTxt(a, b, r.count)}`);
    }
    const ser = await get("/api/stats/platform-time-series?chainId=4217&range=30d&bucket=day"), days = ser.slice(0, -1);  // today is partial
    const paid = {}, setl = {}; for (const aw of Object.values(SETT)) for (const [at, amt] of aw) { const d = at.slice(0, 10); paid[d] = (paid[d] || 0) + amt; setl[d] = (setl[d] || 0) + 1; }
    const badPaid = days.filter((r) => Number(r.paidVolume) !== (paid[r.bucket] || 0));
    add("API reconcile", "payouts per day, 30 full days", badPaid.length ? "FAIL" : "PASS", badPaid.length ? badPaid.slice(0, 3).map((r) => `${r.bucket}: ours ${paid[r.bucket] || 0} vs API ${r.paidVolume}`).join("; ") : `${days.length} days match exactly, ${sum(days.map((r) => Number(r.paidVolume))) / 1e6} paid`);
    const cr = {}, rw = {}; for (const t of T) { const d = t.createdAt.slice(0, 10); cr[d] = (cr[d] || 0) + 1; rw[d] = (rw[d] || 0) + t.reward; }
    const dc = days.map((r) => [r.bucket, Number(r.tasksCreated) - (cr[r.bucket] || 0), Number(r.rewardVolume) - (rw[r.bucket] || 0)]).filter((x) => x[1] || x[2]);
    const over = dc.filter((x) => x[1] < 0 || x[2] < 0), missing = sum(dc.map((x) => Math.max(0, x[1])));
    add("API reconcile", "tasks and rewards posted per day, 30 full days", over.length ? "FAIL" : dc.length ? (missing <= gap ? "WARN" : "FAIL") : "PASS",
      dc.length ? `${dc.length} day(s) differ: ${dc.slice(0, 3).map((x) => `${x[0]} +${x[1]} tasks`).join("; ")} (API counts tasks not in the public list)` : `${days.length} days match exactly`);
    const open = T.filter((t) => t.submissionCount > 0), pick = []; let seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
    for (let i = 0; i < 5 && open.length; i++) { seed = (seed * 16807) % 2147483647; pick.push(open[seed % open.length]); }
    if (process.env.VERIFY_SAMPLE) pick.splice(0, 5, ...T.filter((t) => process.env.VERIFY_SAMPLE.split(",").includes(t.referenceCode)));  // testing only
    // Taskmarket's submissionCount leaves out rejected entries, so rejected ones in task-stories are not counted.
    // Known source limits (checked Nov 25 2026): task-stories returns at most 500 submissions per task, and for some
    // finished tasks it returns an empty list. Those, and a count that moved since the fetch, are WARN, never FAIL,
    // and only after one refetch. Any other mismatch is a FAIL.
    const CAP = 500, sub = [];
    const read = async (t) => {
      const live = await get("/api/tasks/" + t.id), s = await get("/api/task-stories?taskIds=" + t.id);
      const all = new Set(), kept = new Set(); (function w(o) { if (Array.isArray(o)) o.forEach(w); else if (o && typeof o === "object") { if (o.submittedAt && o.id) { all.add(o.id); if (!o.rejectedAt) kept.add(o.id); } Object.values(o).forEach(w); } })(s);
      return { now: live.submissionCount, status: live.status, raw: all.size, stories: kept.size, rejected: all.size - kept.size };
    };
    const judge = (ours, r) => {
      if (ours === r.now && r.now === r.stories) return ["PASS", ""];
      if (r.raw >= CAP && r.now >= CAP && ours >= CAP) return ["WARN", `task-stories stops at ${CAP} (task has ${r.now})`];
      if (r.raw === 0 && r.now > 0) return ["WARN", "task-stories sent an empty list"];
      if (r.now === r.stories && r.now !== ours) return ["WARN", `count moved during the fetch (${ours} → ${r.now})`];
      return ["FAIL", "counts disagree"];
    };
    for (const t of pick) {
      let r = await read(t), [st, why] = judge(t.submissionCount, r), tries = 1;
      if (st !== "PASS") { await new Promise((z) => setTimeout(z, 1500)); r = await read(t); [st, why] = judge(t.submissionCount, r); tries = 2; }
      sub.push({ code: t.referenceCode, ours: t.submissionCount, ...r, st, why, tries });
    }
    const subSt = sub.some((x) => x.st === "FAIL") ? "FAIL" : sub.some((x) => x.st === "WARN") ? "WARN" : "PASS";
    add("API reconcile", "submissions (5 random tasks vs task-stories)", subSt,
      sub.map((x) => `${x.code}: ${x.ours}/${x.now}/${x.stories}${x.rejected ? ` (+${x.rejected} rejected)` : ""}${x.st !== "PASS" ? ` ${x.st}: ${x.why}${x.tries > 1 ? ", same after a refetch" : ""}` : ""}`).join(" · "));
    // Machine-readable rows for the email (ours = in our data, now = Taskmarket now, stories = task-stories).
    checks[checks.length - 1].rows = sub.map((x) => ({ task: x.code, ours: x.ours, now: x.now, stories: x.stories, rejected: x.rejected, status: x.st, why: x.why }));
  } catch (e) { add("API reconcile", "API reachable", "FAIL", String(e.message || e)); }
} else add("API reconcile", "skipped", "WARN", "--no-api");

const pass = !checks.some((c) => c.status === "FAIL");
const res = { at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), dataAsOf: M.asOf, pass, counts: { PASS: checks.filter((c) => c.status === "PASS").length, WARN: checks.filter((c) => c.status === "WARN").length, FAIL: checks.filter((c) => c.status === "FAIL").length }, checks };
writeFileSync(`${STATE}/verify-last.json`, JSON.stringify(res, null, 1));
const byGroup = {}; for (const c of checks) (byGroup[c.group] ||= []).push(c);
for (const [g, cs] of Object.entries(byGroup)) { const f = cs.filter((c) => c.status === "FAIL").length, w = cs.filter((c) => c.status === "WARN").length; console.log(`${f ? "FAIL" : w ? "WARN" : "PASS"}  ${g} (${cs.length} checks${f ? `, ${f} failed` : ""}${w ? `, ${w} warning` : ""})`); for (const c of cs) if (c.status !== "PASS") console.log(`      ${c.status} ${c.name}: ${c.detail}`); }
console.log(`${pass ? "VERIFIED" : "NOT VERIFIED"}: ${res.counts.PASS} pass, ${res.counts.WARN} warn, ${res.counts.FAIL} fail`);
process.exit(pass ? 0 : 1);
