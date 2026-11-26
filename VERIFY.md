# Data accuracy checks (TSK-BRK611AN dashboard)

The page only ever shows data that passed `verify.mjs`.

## How the data is built
- One canonical task set per chain (`fetch.py`, `canonical()`): the unfiltered `/api/tasks` list and the per-status lists
  (`status=open|completed|cancelled|expired|claimed|pending_approval|worker_selected`) merged and de-duplicated by task id.
  Each list alone misses tasks; the union matches Taskmarket's own status totals.
- "Open now" = in the `status=open` list and not past its deadline (equals Taskmarket's `openTasks`).
  Money flow's "Not settled yet" is wider: every task not paid and not expired/cancelled, including tasks past their
  deadline that are still open, claimed, awaiting approval or with a worker selected. The page labels both and explains
  the difference in "How this works".
- Tasks not in public lists: Taskmarket's own status and mode totals (`/api/stats/breakdowns`, both chains) include a
  few tasks that no public list returns. Checked Nov 26 2026: every status, mode and phase filter, the requester filter
  and the explorer feed (which only reaches back about four weeks) leave them out, and `platform-time-series` shows
  they were all posted in June 2026 (2 on Jun 21, 15 on Jun 29; 15 still "open" past their deadline, 2 "worker
  selected"). They cannot be fetched, so `fetch.py` records them as `unlisted` (per status and per mode, measured
  against Taskmarket's totals taken right after the lists are read). In the Both view, "By status" and "By mode" show
  Taskmarket's totals with "N not in public lists"; every other section counts only the fetched tasks.
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
   Rejected entries in task-stories are left out (Taskmarket's count leaves them out too). Three known source limits are a
   WARN, never a FAIL, and only after one refetch: task-stories stops at 500 submissions per task, it returns an empty
   list for some finished tasks, and a count can move while the data is read. Any other mismatch is a FAIL.

Result: PASS, WARN or FAIL per check. Any FAIL blocks publishing. Each Taskmarket status total must equal the listed
count plus the unlisted count for that status. The check "tasks not in public lists" makes sure the unlisted counts are
exactly the tasks missing from the lists: the status gaps, the mode gaps and Taskmarket's total minus our task count must
all be equal (WARN only if Taskmarket's totals changed while the lists were read, FAIL otherwise).

## Run by hand
```
cd .
S=www
python3 -I fetch.py --out $S/data --state .state --full --stage      # build candidate data
/opt/node-v24/bin/node verify.mjs --data $S/data --state .state      # check it (add --no-api to skip the API calls)
python3 -I publish.py $S/data .state                                 # only if the line above printed VERIFIED
```
To check the data that is live now: `node verify.mjs --data $S/data --state .state --file market.json`.
