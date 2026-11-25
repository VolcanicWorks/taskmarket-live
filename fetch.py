#!/usr/bin/env python3
"""Server-side data fetcher for the Taskmarket market visualizer (MIT).

The Taskmarket API does not allow browser requests from other sites, so this script fetches the
public API on the server and writes static JSON next to the page:
  data/market.json  everything except live payouts   (--full, run every 15 minutes)
  data/live.json    recent payouts, both chains        (--live, run every minute)
Python 3.9+ standard library only. No keys, no wallet. Usage:
  python3 fetch.py --out public/data --full
  python3 fetch.py --out public/data --live
"""
import argparse, collections, re, datetime as dt, json, os, statistics, sys, time, urllib.error, urllib.parse, urllib.request

API = "https://api.taskmarket.dev"
EVERY = int(os.environ.get("LIVE_EVERY", "10"))
CHAINS = {"4217": {"name": "Tempo", "token": "OUSD"}, "8453": {"name": "Base", "token": "USDC"}}
UA = {"User-Agent": "taskmarket-market-visualizer/1.0 (read-only; open source)", "Accept": "application/json"}


class RateLimited(Exception):
    def __init__(self, wait):
        super().__init__("rate limited")
        self.wait = wait


def get(path, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + path, headers=UA), timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:  # never retry through a rate limit: let the caller back off
                ra = e.headers.get("Retry-After") if e.headers else None
                raise RateLimited(int(ra) if ra and ra.isdigit() else 60)
            if i == tries - 1:
                raise RuntimeError("%s: %s" % (path, e))
            time.sleep(2 * (i + 1))
        except Exception as e:  # noqa: BLE001 - retry any network error, then give up
            if i == tries - 1:
                raise RuntimeError("%s: %s" % (path, e))
            time.sleep(2 * (i + 1))


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(ts):
    return dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))


def write(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    os.replace(tmp, path)


def tasks_all(chain):
    out, cur = [], None
    for _ in range(60):
        d = get("/api/tasks?chainId=%s&sort=newest&limit=100" % chain + ("&cursor=" + urllib.parse.quote(cur) if cur else ""))
        items = d.get("tasks") or d.get("items") or d.get("data") or []
        out += items
        cur = d.get("nextCursor")
        if not cur or not items:
            break
    return out


def outcome(status):
    return "paid" if status == "completed" else ("died" if status in ("expired", "cancelled") else "open")


# Kind of work, from a task's tags and title. Fixed keyword rules, first match wins (listed on the page).
TYPE_RULES = [
    ("Code", ["javascript", "typescript", "python", "rust", "solidity", "code", "coding", "script*", "api", "apis", "github", "repo", "repository", "function*", "bug*", "implement*", "cli", "html", "css", "sql", "workflow*", "contract*", "deploy*", "app", "apps", "dashboard*", "game", "games", "plugin*", "bot", "bots", "host", "hosted", "hosting", "visualizer*", "debug*", "refactor*", "test", "tests", "patch"]),
    ("Design", ["design*", "logo*", "svg", "icon*", "illustrat*", "image*", "poster*", "banner*", "artwork*", "avatar*", "emblem*", "draw*", "visual*", "brand*", "mockup*", "cover", "covers", "sticker*", "font*", "ui", "ux", "png", "graphic*"]),
    ("Video and audio", ["video*", "music", "song*", "audio", "shorts", "animat*", "trailer*", "cinematic*", "podcast*", "voice*", "soundtrack*", "jingle*"]),
    ("Writing", ["write", "writes", "writing", "written", "essay*", "article*", "blog*", "copy", "copywriting", "tagline*", "poem*", "story", "stories", "summar*", "translat*", "slogan*", "headline*", "manifesto*", "text", "word", "words", "name", "names", "naming", "lyrics", "caption*"]),
    ("Research and data", ["research*", "find", "list", "compare", "comparison", "analy*", "data", "dataset*", "report*", "spreadsheet*", "itinerary", "plan", "spec", "specs", "guide*", "rental*", "odds", "predict*", "survey*", "benchmark*", "review*"]),
    ("Ideas and marketing", ["idea*", "growth*", "marketing", "market", "suggest*", "campaign*", "meme*", "tweet*", "thread*", "promo*", "pitch*", "hack*"]),
]
_RX = [(n, re.compile("|".join(r"\b" + re.escape(w[:-1]) + r"\w*" if w.endswith("*") else r"\b" + re.escape(w) + r"\b" for w in ws))) for n, ws in TYPE_RULES]


def kind_of(t):
    tags = " ".join(t.get("tags") or []).lower()
    title = ((t.get("title") or (t.get("description") or "").split("\n")[0]) or "").lower()
    hay = tags.replace("-", " ") + " | " + title
    for name, rx in _RX:
        if rx.search(hay):
            return name
    return "Other"


def extras(all_tasks, names, now):
    """Task types, top posters and entries per task, both chains together."""
    wk = now - dt.timedelta(days=7); wk2 = now - dt.timedelta(days=14)
    types = collections.OrderedDict((n, {"type": n, "tasks": 0, "reward": 0, "thisWeek": 0, "lastWeek": 0}) for n, _ in TYPE_RULES + [("Other", [])])
    post = {}
    subs = []
    for c, t in all_tasks:
        k = kind_of(t); ty = types[k]; r = int(t.get("reward") or 0); d = parse(t["createdAt"])
        ty["tasks"] += 1; ty["reward"] += r
        if d >= wk: ty["thisWeek"] += 1
        elif d >= wk2: ty["lastWeek"] += 1
        a = (t.get("requester") or "").lower()
        p = post.setdefault(a, {"address": a, "name": names.get(a), "tasks": 0, "reward": 0, "chains": set()})
        p["tasks"] += 1; p["reward"] += r; p["chains"].add(CHAINS[c]["name"])
        subs.append((int(t.get("submissionCount") or 0), c, t))
    tot_r = sum(p["reward"] for p in post.values()) or 1; tot_n = sum(p["tasks"] for p in post.values()) or 1
    byr = sorted(post.values(), key=lambda p: (-p["reward"], p["address"]))
    top = [dict(p, chains=sorted(p["chains"]), share=round(100 * p["reward"] / tot_r, 1)) for p in byr[:10]]
    byn = sorted(post.values(), key=lambda p: -p["tasks"])
    n = sorted(x for x, _, _ in subs)
    q = lambda f: n[min(len(n) - 1, int(f * (len(n) - 1) + 0.5))] if n else 0
    edges = [(0, 0), (1, 1), (2, 5), (6, 10), (11, 25), (26, 50), (51, 100), (101, 10 ** 9)]
    hist = [{"label": (str(a) if a == b else ("%d+" % a if b > 10 ** 8 else "%d–%d" % (a, b))), "tasks": sum(1 for x in n if a <= x <= b)} for a, b in edges]
    hot = sorted([(x, c, t) for x, c, t in subs if t.get("status") == "open"], key=lambda z: -z[0])[:6]
    return {
        "types": list(types.values()),
        "posters": {"top": top, "count": len(post), "totalReward": tot_r, "totalTasks": tot_n,
                    "top5RewardShare": round(100 * sum(p["reward"] for p in byr[:5]) / tot_r, 1),
                    "top5TaskShare": round(100 * sum(p["tasks"] for p in byr[:5]) / tot_n, 1)},  # the same 5 posters as the table
        "entries": {"tasks": len(n), "mean": round(sum(n) / max(1, len(n)), 1), "median": q(0.5), "p90": q(0.9), "max": n[-1] if n else 0,
                    "zero": sum(1 for x in n if x == 0), "hist": hist,
                    "hotOpen": [{"code": t.get("referenceCode"), "taskId": t["id"], "chainId": c, "entries": x, "reward": int(t.get("reward") or 0),
                                 "title": clean(t.get("title") or (t.get("description") or "").split("\n")[0])[:90], "expiry": t.get("expiryTime")} for x, c, t in hot]},
    }


def settlements(state_dir, completed, cap):
    """Payout times for completed tasks ({taskId: [[settledAt, amount], ...]}), fetched once per task from
    /api/tasks/{id} and cached. At most `cap` new lookups per run, spaced out, so the API is never hammered."""
    path = os.path.join(state_dir, "settlements.json")
    try:
        st = json.load(open(path))
    except Exception:
        st = {}
    todo = [tid for tid in completed if tid not in st][:cap]
    limited = 0
    for i, tid in enumerate(todo):
        try:
            d = get("/api/tasks/" + tid)
        except RateLimited as e:  # wait it out; give up for this run after 3 rate limits
            limited += 1
            time.sleep(min(120, e.wait))
            if limited >= 3:
                break
            continue
        except Exception:
            continue
        st[tid] = [[a["settledAt"], int(a.get("workerPayment") or a.get("grossAmount") or 0)] for a in d.get("awards") or [] if a.get("settledAt")]
        if i % 25 == 24:
            json.dump(st, open(path + ".tmp", "w")); os.replace(path + ".tmp", path)
        time.sleep(1.0)
    json.dump(st, open(path + ".tmp", "w")); os.replace(path + ".tmp", path)
    return st


def chain_series(tasks, sett, now):
    """Per-chain versions of the platform time series, rebuilt from the task list (posted) and payout times (paid).
    Daily buckets for 7d/30d/90d (today included, like the API), weekly (Monday) buckets for all."""
    day = lambda d: d.date().isoformat()
    created, reward, paid = collections.Counter(), collections.Counter(), collections.Counter()
    for t in tasks:
        d = parse(t["createdAt"]); created[day(d)] += 1; reward[day(d)] += int(t.get("reward") or 0)
        for at, amt in sett.get(t["id"], []):
            paid[day(parse(at))] += amt
    out = {}
    today = now.date()
    for rng, n in (("7d", 7), ("30d", 30), ("90d", 90)):
        ks = [(today - dt.timedelta(days=i)).isoformat() for i in range(n, -1, -1)]
        out[rng] = [{"bucket": k, "tasksCreated": created[k], "rewardVolume": reward[k], "paidVolume": paid[k], "activeAgents": None} for k in ks]
    wk = lambda k: (dt.date.fromisoformat(k) - dt.timedelta(days=dt.date.fromisoformat(k).weekday())).isoformat()
    W = collections.defaultdict(lambda: [0, 0, 0])
    for k, v in created.items(): W[wk(k)][0] += v
    for k, v in reward.items(): W[wk(k)][1] += v
    for k, v in paid.items(): W[wk(k)][2] += v
    out["all"] = [{"bucket": k, "tasksCreated": a, "rewardVolume": r, "paidVolume": p, "activeAgents": None} for k, (a, r, p) in sorted(W.items())]
    return out


STATUSES = ["open", "completed", "cancelled", "expired", "claimed", "pending_approval", "worker_selected"]


def clean(s):
    """One-line title: escaped or real newlines become spaces, leading markdown '#' is dropped."""
    s = (s or "").replace("\\n", " ").replace("\\r", " ").replace("\n", " ").replace("\r", " ")
    return re.sub(r"^#+\s*", "", re.sub(r"\s+", " ", s).strip())


def pages(q):
    out, cur = [], None
    for _ in range(60):
        d = get("/api/tasks?" + q + "&sort=newest&limit=100" + ("&cursor=" + urllib.parse.quote(cur) if cur else ""))
        items = d.get("tasks") or d.get("items") or d.get("data") or []
        out += items
        cur = d.get("nextCursor")
        if not cur or not items:
            break
    return out


def canonical(c, now):
    """The single normalized task set for one chain. The unfiltered task list and the status-filtered lists each
    miss some tasks, so the set is their union, deduplicated by task id. 'Open now' = in the status=open list and
    not past its deadline (this equals Taskmarket's own openTasks figure)."""
    seen, open_ids = {}, set()
    for t in pages("chainId=" + c):
        seen[t["id"]] = t
    for st in STATUSES:
        for t in pages("chainId=%s&status=%s" % (c, st)):
            seen.setdefault(t["id"], t)
            if st == "open":
                open_ids.add(t["id"])
    out = []
    for t in seen.values():
        if str(t.get("chainId")) != c:
            continue
        n = dict(t)
        n["title"] = clean(t.get("title") or (t.get("description") or "").split("\n")[0])[:140]
        n["requester"] = (t.get("requester") or "").lower()
        n["reward"] = int(t.get("reward") or 0)
        n["submissionCount"] = int(t.get("submissionCount") or 0)
        exp = t.get("expiryTime")
        n["openNow"] = t["id"] in open_ids and (not exp or parse(exp) > now)
        n["chain"] = c
        out.append(n)
    return sorted(out, key=lambda t: t["id"])


def build_view(ts, names, sett, now):
    """Every number a section shows for one filter (Both, Tempo or Base), from one task list. No section computes its own."""
    v = {"taskCount": len(ts), "openNow": sum(1 for t in ts if t["openNow"])}
    oc = collections.Counter(outcome(t["status"]) for t in ts)
    v.update(paidTasks=oc["paid"], diedTasks=oc["died"], otherTasks=oc["open"])
    by = collections.defaultdict(lambda: {"reward": 0, "tasks": 0})
    for t in ts:
        by[t["requester"]]["reward"] += t["reward"]; by[t["requester"]]["tasks"] += 1
    v["posterCount"] = len(by)
    funders = sorted(by.items(), key=lambda kv: (-kv[1]["reward"], kv[0]))[:3]
    top = {a for a, _ in funders}
    fl = collections.Counter()
    for t in ts:
        fl[(t["requester"] if t["requester"] in top else "others", outcome(t["status"]))] += t["reward"]
    v["flows"] = [{"from": a, "to": o, "amount": x} for (a, o), x in sorted(fl.items())]
    v["funders"] = [{"address": a, "name": names.get(a), "reward": b["reward"], "tasks": b["tasks"]} for a, b in funders]
    v["others"] = {"tasks": len(ts) - sum(b["tasks"] for _, b in funders), "wallets": len(by) - len(funders),
                   "reward": sum(t["reward"] for t in ts if t["requester"] not in top)}
    byn = sorted(by.items(), key=lambda kv: (-kv[1]["tasks"], kv[0]))[:3]
    v["top3Tasks"] = [{"address": a, "name": names.get(a), "tasks": b["tasks"]} for a, b in byn]
    v["top3Share"] = round(100 * sum(b["tasks"] for _, b in byn) / max(1, len(ts)), 1)
    week = collections.defaultdict(set)
    for t in ts:
        d = parse(t["createdAt"]); week[(d - dt.timedelta(days=d.weekday())).date().isoformat()].add(t["requester"])
    v["postersPerWeek"] = [{"week": w, "posters": len(x)} for w, x in sorted(week.items())]
    v.update(extras([(t["chain"], t) for t in ts], names, now))
    v["breakdowns"] = {"mode": [{"mode": k, "count": n} for k, n in sorted(collections.Counter(t.get("mode") or "unknown" for t in ts).items())],
                       "status": [{"status": k, "count": n} for k, n in sorted(collections.Counter(t["status"] for t in ts).items())]}
    v["series"] = chain_series(ts, sett, now)
    done = [t["id"] for t in ts if t["status"] == "completed"]
    v["settledCoverage"] = [sum(1 for i in done if i in sett), len(done)]
    v["rewardTotal"] = sum(t["reward"] for t in ts)
    return v


def full(out, state_dir, name="market.json"):
    now = dt.datetime.now(dt.timezone.utc)
    names, reqs, canon = {}, {}, {}
    m = {"asOf": now_iso(), "chains": {}, "series": {}, "sources": [], "views": {}}
    src = m["sources"]
    snap = lambda: {"openTasks": get("/api/market/stats?chainId=4217")["openTasks"],
                    "status": {r["status"]: r["count"] for r in get("/api/stats/breakdowns?chainId=4217")["status"]}}
    m["apiWindow"] = {"before": snap()}  # Taskmarket's own totals just before and just after the task lists are read
    for c in CHAINS:
        canon[c] = canonical(c, now)
        m["chains"][c] = {"name": CHAINS[c]["name"], "token": CHAINS[c]["token"], "stats": get("/api/market/stats?chainId=" + c)}
        for t in canon[c]:
            reqs[t["id"]] = t["requester"]
            if t.get("requesterDisplayName"):
                names[t["requester"]] = t["requesterDisplayName"]
        src += ["/api/market/stats?chainId=" + c, "/api/tasks?chainId=%s (all pages, unfiltered and per status, merged by id)" % c]
    m["apiWindow"]["after"] = snap()
    every = canon["4217"] + canon["8453"]
    sett = settlements(state_dir, [t["id"] for t in every if t["status"] == "completed"], int(os.environ.get("SETTLE_CAP", "150")))
    m["views"]["both"] = build_view(every, names, sett, now)
    for c in CHAINS:
        m["views"][c] = build_view(canon[c], names, sett, now)
    for rng, bucket in (("7d", "day"), ("30d", "day"), ("90d", "day"), ("all", "week")):
        m["series"][rng] = get("/api/stats/platform-time-series?chainId=4217&range=%s&bucket=%s" % (rng, bucket))
        src.append("/api/stats/platform-time-series?range=%s&bucket=%s" % (rng, bucket))
    m["apiBreakdowns"] = get("/api/stats/breakdowns?chainId=4217")
    m["heatmap"] = get("/api/stats/activity-heatmap?chainId=4217&range=30d&dimension=hourOfWeek")
    feed = get("/api/stats/activity-feed?chainId=4217&limit=50")["items"]
    more, cur = [], None
    for _ in range(20):  # the feed mixes both chains and Base is quieter: page back for its latest 25 events
        d = get("/api/stats/activity-feed?chainId=8453&limit=50" + ("&cursor=" + urllib.parse.quote(cur) if cur else ""))
        more += [i for i in d.get("items", []) if str(i.get("chainId")) == "8453"]
        cur = d.get("nextCursor")
        if len(more) >= 25 or not cur:
            break
    for i in feed + more:
        i["taskTitle"] = clean(i.get("taskTitle"))
    m["feed"], m["feedMore"] = feed, more[:25]
    src += ["/api/tasks/{id} (awards.settledAt, payout times)", "/api/stats/breakdowns", "/api/stats/activity-heatmap?range=30d&dimension=hourOfWeek", "/api/stats/activity-feed?limit=50"]
    m["typeRules"] = [[n, w] for n, w in TYPE_RULES]
    m["names"] = names  # display names exactly as Taskmarket returns them; none are inferred
    write(os.path.join(out, name), m)
    write(os.path.join(state_dir, "tasks.json"), [{k: t.get(k) for k in ("id", "chain", "requester", "reward", "status", "mode", "createdAt", "expiryTime", "submissionCount", "title", "openNow", "tags", "referenceCode")} for t in every])
    write(os.path.join(state_dir, "requesters.json"), reqs)
    return m


def live(out, state_dir):
    state_path = os.path.join(state_dir, "live-state.json")
    """New payouts: completed tasks not seen before, with their award settlement from /api/tasks/{id}."""
    try:
        st = json.load(open(state_path))
    except Exception:  # first run
        st = {"seen": {}, "payouts": []}
    first = not st["seen"]
    try:
        reqof = json.load(open(os.path.join(state_dir, "requesters.json")))
    except Exception:
        reqof = {}
    fresh = []
    for c in CHAINS:
        n_c = 0
        d = get("/api/tasks?chainId=%s&status=completed&sort=newest&limit=100" % c)
        for t in d.get("tasks") or d.get("items") or d.get("data") or []:
            if t["id"] in st["seen"]:
                continue
            st["seen"][t["id"]] = 1
            if first and n_c >= 40:  # backfill the newest 40 per chain on the first run
                continue
            n_c += 1
            det = get("/api/tasks/" + t["id"])
            for a in det.get("awards") or []:
                if not a.get("settledAt"):
                    continue
                fresh.append({"taskId": t["id"], "code": t.get("referenceCode"), "chainId": c, "title": clean(t.get("title") or (t.get("description") or "").split("\n")[0])[:90],
                              "poster": (t.get("requester") or reqof.get(t["id"], "")).lower(), "winner": (a.get("workerAddress") or "").lower(),
                              "posterName": det.get("requesterDisplayName") or t.get("requesterDisplayName"), "winnerName": a.get("workerDisplayName"),
                              "amount": int(a.get("workerPayment") or a.get("grossAmount") or 0), "settledAt": a["settledAt"],
                              "createdAt": t.get("createdAt"), "hoursToPay": round((parse(a["settledAt"]) - parse(t["createdAt"])).total_seconds() / 3600, 2)})
    st["payouts"] = sorted(st["payouts"] + fresh, key=lambda p: p["settledAt"])[-300:]
    json.dump(st, open(state_path + ".tmp", "w"))
    os.replace(state_path + ".tmp", state_path)
    hrs = [p["hoursToPay"] for p in st["payouts"] if p["hoursToPay"] >= 0]
    feed = get("/api/stats/activity-feed?chainId=4217&limit=50")["items"]
    for i in feed:
        i["taskTitle"] = clean(i.get("taskTitle"))
    write(os.path.join(out, "live.json"), {"asOf": now_iso(), "payouts": st["payouts"][-40:], "feed": feed,
                                           "medianHoursToPay": round(statistics.median(hrs), 1) if hrs else None, "sample": len(hrs),
                                           "source": "/api/tasks?status=completed&sort=newest&limit=100 and /api/tasks/{id} (awards.settledAt)", "everySeconds": EVERY})
    return len(fresh)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--state", required=True, help="private folder for state files (not served)")
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--stage", action="store_true", help="with --full: write market.next.json for verify.mjs instead of publishing")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--every", type=float, default=0, help="with --live: keep running, one live fetch every N seconds, backing off on 429s and errors")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    os.makedirs(a.state, exist_ok=True)
    if a.full:
        full(a.out, a.state, "market.next.json" if a.stage else "market.json")
    if a.live and a.every > 0:
        wait = a.every
        while True:
            t0 = time.time()
            try:
                n = live(a.out, a.state)
                if n:
                    print(now_iso(), "new payouts:", n, flush=True)
                wait = a.every
            except RateLimited as e:
                wait = min(300, max(e.wait, wait * 2))
                print(now_iso(), "429 from the API, backing off %ds" % wait, flush=True)
            except Exception as e:  # noqa: BLE001
                wait = min(300, wait * 2)
                print(now_iso(), "live fetch failed (%s), next try in %ds" % (e, wait), flush=True)
            time.sleep(max(0.5, wait - (time.time() - t0)))
    elif a.live:
        n = live(a.out, a.state)
        print(now_iso(), "new payouts:", n)
