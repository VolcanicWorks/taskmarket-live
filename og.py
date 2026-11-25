#!/usr/bin/env python3
"""Builds og.html (1200x630 share card) from data/market.json; render it to og.png with any headless browser."""
import json, sys, html
out = sys.argv[1]
m = json.load(open(out + "/data/market.json"))
t = m["chains"]["4217"]; fl = t["flows"]; tot = sum(f["amount"] for f in fl) or 1; paid = sum(f["amount"] for f in fl if f["to"] == "paid")
s30 = m["series"]["30d"]; posted = sum(int(r["rewardVolume"]) for r in s30) / 1e6; paid30 = sum(int(r["paidVolume"]) for r in s30) / 1e6
bands = ""; y0 = {}; y1 = {"paid": 120, "open": 330, "died": 470}
froms = sorted({f["from"] for f in fl}, key=lambda a: (a == "others", -sum(f["amount"] for f in fl if f["from"] == a)))
yy = 90
for a in froms:
    y0[a] = yy; yy += 40 + 300 * sum(f["amount"] for f in fl if f["from"] == a) / tot
for f in fl:
    w = max(2, 260 * f["amount"] / tot); c = {"paid": "#E63F78", "open": "#9FB49A", "died": "#6b6058"}[f["to"]]
    bands += '<path d="M640 %.0f C860 %.0f 900 %.0f 1150 %.0f" stroke="%s" stroke-width="%.0f" stroke-opacity=".55" fill="none"/>' % (y0[f["from"]], y0[f["from"]], y1[f["to"]], y1[f["to"]], c, w)
open(out + "/og.html", "w").write("""<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:IS;src:url(fonts/InstrumentSerif-Regular.ttf)}@font-face{font-family:IS;font-style:italic;src:url(fonts/InstrumentSerif-Italic.ttf)}@font-face{font-family:DM;src:url(fonts/DepartureMono-Regular.woff2)}@font-face{font-family:IT;src:url(fonts/InterTight-Variable.ttf)}
body{margin:0;width:1200px;height:630px;background:#12100E radial-gradient(ellipse at 95%% 0,#3A1420,transparent 60%%);color:#EFE9E2;font-family:IT;overflow:hidden;position:relative}
h1{font:400 92px/0.95 IS,serif;margin:0;position:absolute;left:60px;top:70px;width:620px}h1 i{color:#E63F78}
.n{position:absolute;left:60px;top:330px;display:flex;gap:44px}.n b{display:block;font:400 54px IS,serif}.n span{font:15px DM,monospace;color:#B0A79D}
.f{position:absolute;left:60px;bottom:40px;font:18px DM,monospace;color:#B0A79D}svg{position:absolute;left:0;top:0}</style>
<svg width="1200" height="630">%s</svg><h1>Where the money <i>flows.</i></h1>
<div class="n"><div><b>%d%%</b><span>of Tempo rewards paid out</span></div><div><b>%s</b><span>posted in 30 days</span></div><div><b>%s</b><span>paid in 30 days</span></div></div>
<div class="f">taskmarket.dev market visualizer · unofficial · data %s</div>""" % (bands, round(100 * paid / tot), "{:,.0f}".format(posted), "{:,.0f}".format(paid30), html.escape(m["asOf"][:16].replace("T", " ")) + " UTC"))
