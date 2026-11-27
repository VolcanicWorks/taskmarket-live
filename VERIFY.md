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
- Task titles are the posters' own text, not our data. They are shown as plain text: newlines become spaces, leading
  markdown marks (`#`, `>`, `*`, `-`) and `**bold**` markers are removed, and the page escapes HTML. They are never checked
  and can never block publishing.
- Tasks not in public lists are also recorded by the day they were posted (`unlisted.days`: Taskmarket's all-time daily
  counts minus the listed tasks; Nov 27 2026: Jun 21: 2, Jun 29: 15, Nov 25: 3). The "Tasks posted" and "Rewards posted"
  charts note them as "+N not in public lists" for the range shown (Both view).
- Every section's numbers for Both, Tempo and Base come from one function, `build_view()`, run on that set. The page does
  no counting of its own. Payout times come from `/api/tasks/{id}` (`awards.settledAt`), cached in `.state/settlements.json`.

## When the checks run
Every full refresh (every 15 minutes, run by `serve.py`): fetch into `data/market.next.json`, run `verify.mjs`,
and only on exit 0 run `publish.py`, which stamps `verifiedAt` and replaces `data/market.json`. If the check fails,
`serve.py` waits about 3 minutes, fetches fresh data once and checks again. On a second failure the last verified data
stays live and the reasons go to the log and `.state/verify-last.json`. The page shows "verified HH:MM UTC" next to
"data as of".

Frozen alarm: if the published data gets over 45 minutes old, `serve.py` logs `FROZEN since <time>` (and runs
`--alert-cmd` with that message, for example a mail script), again every hour until new data publishes, then one
`Back live`.

## The checks
1. **Consistency, per filter** (Both, Tempo, Base): status breakdown, mode breakdown, kind of work, entries per task,
   top-posters base, paid + died + other, and funders + others all equal the canonical task count; money flows,
   funders + others and the top-posters base all equal the reward total.
2. **Tempo + Base = Both** for task counts, open now, paid, died, other, reward total, every status and every kind of work.
3. **Independent recompute** from `.state/tasks.json`: counts, open now, reward total, the top 3 funders and the top 10
   posters (order), the top-5 reward share and the top-5 task share (same 5 posters), entries median and max, and the
   kind-of-work split (from the same published word rules).
4. **Sanity**: no NaN, Infinity, negative number, missing required count or escape text in our own computed fields,
   including the live feed and payouts file. Poster text (titles, names, tags, descriptions) is skipped.
5. **Live API reconcile** (fresh calls): open now = `/api/market/stats` openTasks; every status total =
   `/api/stats/breakdowns`; payouts per day and tasks + rewards posted per day for the last 30 full days =
   `/api/stats/platform-time-series`; 5 random tasks' entry counts = `/api/tasks/{id}` and `/api/task-stories`.
   Rejected entries in task-stories are left out (Taskmarket's count leaves them out too). The test is our count against
   Taskmarket's own count (`submissionCount`); task-stories is only a second witness, and for finished tasks it often
   lists only the winning entries (for example 1 of 109), stops at 500, or is empty. If only task-stories differs, it is
   a WARN. On an open-tasks mismatch the check waits a moment and refetches once (Taskmarket's count and the open list);
   it passes if the refetch matches. Tasks and rewards posted per day must equal the listed tasks plus exactly the
   unlisted tasks recorded for that day.

Result: PASS, WARN or FAIL per check. Any FAIL blocks publishing.

### What blocks and what only warns (Nov 27 2026)
Only wrong or impossible values in our own data block publishing. Everything else is shown and logged as a warning,
and the data still publishes.

| Blocks publishing (FAIL) | Only warns (WARN), still publishes |
|---|---|
| A section does not add up to the task count or the money total (check 1) | Poster text: markdown, odd characters, newlines in titles (not checked at all) |
| Tempo + Base does not equal Both (check 2) | A Taskmarket list that lags or stops short (task-stories) |
| The recount from the raw tasks does not match the page (check 3) | Tasks Taskmarket counts but no public list returns |
| NaN, null, a negative number or a missing count in our own fields (check 4) | Timing differences against Taskmarket's live totals (a task posted or closed mid-check) |
| | Any other difference from Taskmarket's live API, or the API being unreachable (check 5) |

In check 5 a result that would have been a FAIL is reported as a WARN with "would have failed, does not block" in front,
so it still shows up in the log and the email. Each Taskmarket status total must equal the listed
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
