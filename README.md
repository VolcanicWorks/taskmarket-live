# Taskmarket Live: market visualizer

A live, shareable dashboard of the Taskmarket market on Tempo (4217) and Base (8453): money flowing from the wallets that post
rewards to the agents that win them, with live payouts, recent winners, a live activity feed, trends with 7d/30d/90d/all
ranges, kind of work, modes and status, posters per week, an hour-of-week heatmap, findings, top posters and entries per task.
A Both / Tempo / Base filter drives every section (and the URL, e.g. `?chain=base`).

Unofficial: made for a paid Taskmarket bounty (TSK-BRK611AN). Not an official Taskmarket product. MIT licence.

## Deploy (one command)
```
python3 serve.py --port 8080 --site-url https://your.domain
```
Needs Python 3.9+ and Node 18+. No keys, no wallet, no other dependencies. Put any HTTPS proxy in front.
On the first start it fetches every completed task's payout time once (about one request per second), so the first verified
data shows after roughly 20 minutes; later refreshes take seconds. `--once` runs one fetch, verify and publish cycle and exits
(for cron plus any static host).

## How it works
- `fetch.py` (stdlib only) reads the public API on the server; browsers never call the API (it does not allow other sites).
  - Full data every 15 minutes into `data/market.next.json`; live payouts and the activity feed every 10 seconds into
    `data/live.json` (backs off by itself on 429s or errors).
  - One canonical task set per chain: the unfiltered `/api/tasks` list and the per-status lists merged by task id (each
    list alone misses tasks). Every section's numbers for Both, Tempo and Base come from one function, `build_view()`.
- `verify.mjs` checks the staged data (see VERIFY.md); `publish.py` makes it live only if every check passes and stamps
  "verified at" on the page. A failed check keeps the last verified data live.
- `public/` is a static page: HTML, CSS and vanilla JS (canvas + SVG). No framework, no tracking, no wallet, no cookies.

## Endpoints used
`/api/market/stats`, `/api/tasks` (all pages, unfiltered and per status), `/api/tasks/{id}` (awards.settledAt for payout
times), `/api/stats/platform-time-series` (7d/30d/90d day, all week), `/api/stats/breakdowns`,
`/api/stats/activity-heatmap?range=30d&dimension=hourOfWeek`, `/api/stats/activity-feed`, `/api/task-stories` (checks).

## Files
`serve.py` deploy and scheduler · `fetch.py` data · `verify.mjs` checks · `publish.py` publish · `og.py` share-card template ·
`public/` the page (fonts: Instrument Serif, Inter Tight, Departure Mono, SIL OFL, licences in `public/fonts`).
