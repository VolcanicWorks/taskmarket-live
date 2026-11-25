#!/usr/bin/env python3
"""One-command deploy for the Taskmarket market visualizer (MIT).

    python3 serve.py --port 8080 --site-url https://your.domain

Needs Python 3.9+ and Node 18+ (for verify.mjs). No other dependencies, no keys, no wallet.
What it does:
  1. builds ./www from ./public (fills in --site-url for the share image),
  2. fetches the full market data into a staging file, runs verify.mjs, and publishes it only if every check passes
     (then again every 15 minutes; a failed check keeps the last verified data live),
  3. keeps live payouts and the activity feed fresh every 10 seconds (backs off by itself on 429s or errors),
  4. serves ./www over HTTP.
The first start fetches every completed task's payout time once (about one request per second), so the first verified
data appears after roughly 20 minutes; after that each refresh takes seconds. Put any HTTPS proxy in front for production.
Add --once to run one fetch-verify-publish cycle and exit (useful for cron or a static host)."""
import argparse, functools, http.server, os, shutil, subprocess, sys, threading, time

H = os.path.dirname(os.path.abspath(__file__))


def log(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), *a, flush=True)


def build(www, site_url):
    os.makedirs(os.path.join(www, "data"), exist_ok=True)
    for name in os.listdir(os.path.join(H, "public")):
        src, dst = os.path.join(H, "public", name), os.path.join(www, name)
        if os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)
        elif name == "index.html":
            open(dst, "w").write(open(src).read().replace("__SITE_URL__", site_url.rstrip("/")))
        else:
            shutil.copy2(src, dst)


def full_cycle(www, state, node):
    data = os.path.join(www, "data")
    env = dict(os.environ, SETTLE_CAP=os.environ.get("SETTLE_CAP", "5000"))
    if subprocess.run([sys.executable, "-I", os.path.join(H, "fetch.py"), "--out", data, "--state", state, "--full", "--stage"], env=env).returncode:
        return log("full fetch failed; keeping the last verified data")
    v = subprocess.run([node, os.path.join(H, "verify.mjs"), "--data", data, "--state", state, "--file", "market.next.json"], capture_output=True, text=True)
    print(v.stdout.strip(), flush=True)
    if v.returncode == 0:
        subprocess.run([sys.executable, "-I", os.path.join(H, "publish.py"), data, state])
    else:
        log("data check FAILED: kept the last verified data (details in", os.path.join(state, "verify-last.json") + ")")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--site-url", default="http://localhost:8080", help="public URL of the site, used for the share image")
    ap.add_argument("--www", default=os.path.join(H, "www"))
    ap.add_argument("--state", default=os.path.join(H, ".state"), help="private state, never served")
    ap.add_argument("--node", default="node")
    ap.add_argument("--every", type=int, default=10, help="seconds between live payout/feed refreshes")
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.state, exist_ok=True)
    build(a.www, a.site_url)
    full_cycle(a.www, a.state, a.node)
    if a.once:
        return
    env = dict(os.environ, LIVE_EVERY=str(a.every))
    subprocess.Popen([sys.executable, "-I", os.path.join(H, "fetch.py"), "--out", os.path.join(a.www, "data"), "--state", a.state, "--live", "--every", str(a.every)], env=env)

    def every_15():
        while True:
            time.sleep(900 - time.time() % 900)
            full_cycle(a.www, a.state, a.node)
    threading.Thread(target=every_15, daemon=True).start()

    class Handler(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            if self.path.split("?")[0].startswith("/data/"):
                self.send_header("Cache-Control", "no-store")
            super().end_headers()
    log("serving", a.www, "on port", a.port)
    http.server.ThreadingHTTPServer(("", a.port), functools.partial(Handler, directory=a.www)).serve_forever()


if __name__ == "__main__":
    main()
