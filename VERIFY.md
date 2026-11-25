# Data accuracy checks (TSK-BRK611AN dashboard)

The page only ever shows data that passed `verify.mjs`.

## How the data is built
- One canonical task set per chain (`fetch.py`, `canonical()`): the unfiltered `/api/tasks` list and the per-status lists
  (`status=open|completed|cancelled|expired|claimed|pending_approval|worker_selected`) merged and de-duplicated by task id.
  Each list alone misses tasks; the union matches Taskmarket's own status totals.
- "Open now" = in the `status=open` list and not past its deadline (equals Taskmarket's `openTasks`).
- Titles are cleaned once (escaped or real newlines become spaces, a leading markdown `#` is removed).
- Every section's numbers for Both, Tempo and Base come from one function, `build_view()`, run on that set. The page does
  no counting of its own. Payout times come from `/api/tasks/{id}` (`awards.settledAt`), cached in `.state/settlements.json`.

## When the checks run
Every full refresh (every 15 minutes, run by `serve.py`): fetch into `data/market.next.json`, run `verify.mjs`,
and only on exit 0 run `publish.py`, which stamps `verifiedAt` and replaces `data/market.json`. On a failure the last
verified data stays live, the reasons go to the log and `.state/verify-last.json`
The page shows
"verified HH:MM UTC" next to "data as of".

## The checks
1. **Consistency, per filter** (Both, Tempo, Base): status breakdown, mode breakdown, kind of work, entries per task,
   top-posters base, paid + died + other, and funders + others all equal the canonical task count; money flows,
   funders + others and the top-posters base all equal the reward total.
2. **Tempo + Base = Both** for task counts, open now, paid, died, other, reward total, every status and every kind of work.
3. **Independent recompute** from `.state/tasks.json`: counts, open now, reward total, the top 3 funders and the top 10
   posters (order), the top-5 reward share and the top-5 task share (same 5 posters), entries median and max, and the
   kind-of-work split (from the same published word rules).
4. **Sanity**: no NaN, Infinity, negative number, missing required count, or escape text / markdown in any title,
   including the live feed and payouts file.
5. **Live API reconcile** (fresh calls): open now = `/api/market/stats` openTasks; every status total =
   `/api/stats/breakdowns`; payouts per day and tasks + rewards posted per day for the last 30 full days =
   `/api/stats/platform-time-series`; 5 random tasks' entry counts = `/api/tasks/{id}` and `/api/task-stories`.

Result: PASS, WARN or FAIL per check. Any FAIL blocks publishing. The one known WARN: the API's breakdown counts a few
open / worker-selected tasks that never appear in any public task list (probably private tasks), so they cannot be shown.

## Run by hand
```
cd .
S=www
python3 -I fetch.py --out $S/data --state .state --full --stage      # build candidate data
/opt/node-v24/bin/node verify.mjs --data $S/data --state .state      # check it (add --no-api to skip the API calls)
python3 -I publish.py $S/data .state                                 # only if the line above printed VERIFIED
```
To check the data that is live now: `node verify.mjs --data $S/data --state .state --file market.json`.
