#!/usr/bin/env python3
"""Publish data/market.next.json as data/market.json, stamped with the passing verify run's time. Only called after verify.mjs exits 0."""
import json, os, sys
data, state = sys.argv[1], sys.argv[2]
v = json.load(open(os.path.join(state, "verify-last.json")))
assert v["pass"], "verify did not pass"
m = json.load(open(os.path.join(data, "market.next.json")))
assert m["asOf"] == v["dataAsOf"], "verify result is for different data"
m["verifiedAt"], m["verifyCounts"] = v["at"], v["counts"]
tmp = os.path.join(data, "market.json.tmp")
json.dump(m, open(tmp, "w"), separators=(",", ":")); os.replace(tmp, os.path.join(data, "market.json"))
os.remove(os.path.join(data, "market.next.json"))
print("published", m["asOf"], "verified", m["verifiedAt"])
