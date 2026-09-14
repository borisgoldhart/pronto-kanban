# Pronto Kanban (prototype)

A working prototype of the Pronto Kanban built on **Bryntum TaskBoard**, driven by real
tasks from the Pronto tasks API. Two views:

- **Task Explorer Kanban** (`/inbox/task-explorer`): every task the user can see, with
  swimlanes (User, Department, Project), the system presets and saved views in
  the left nav, and the Task Explorer filter flyout.
- **Project Kanban** (`/projects/:id/kanban`): one project's tasks.

Cards drag between columns (status) and up and down within a column (order). Order is
kept by a global per-task **rank** (see below), so a card sits in the same relative
position on the project board and in Task Explorer.

Same architecture and auth as the SOW Planner and Asset Library: Node/Express backend
(holds credentials, proxies Pronto), single-page front end, shared `pronto-base` nav,
per-user sessions ("Sign in with HavasPronto" PKCE broker, email+password, or token)
stored in Redis.

## What the devs can lift

| Folder | Purpose | Reuse |
|---|---|---|
| `web/src/kanban/` | The board: Bryntum config (`board.config.ts`), card templates (`card.ts`), data model + swimlane mapping (`model.ts`), lane-lazy loading (`lanes.ts`), React lifecycle wrapper (`KanbanBoard.tsx`), Pronto theme over Stockholm (`kanban.css`) | Lift as a unit. Swap `KanbanBoard.tsx` for `@bryntum/taskboard-react-thin` if preferred |
| `server/rank/rank.js` | Rank maths: seed, midpoint, rebalance. Pure functions, unit tested (`npm test`) | Port to PHP for the Pronto API |
| `server/rank/store.js` | Prototype store for ranks / status overrides / prefs | Replaced by a `kanban_rank` column on the task table |
| `server/routes/kanban.js` | `POST /api/kanban/move`, `/rebalance`, prefs | The API contract for the front end |
| `server/pronto.js` | The only file that knows Pronto URL and payload shapes; `normaliseTicket` is the field mapping | Reference for the mapping |
| `web/src/chrome/` | Page chrome for the demo (banner, tabs, left nav, control strip, filter flyout) | Design reference only; Pronto's own pages supply these |

Bryntum: the prototype uses the public trial (`@bryntum/taskboard` is an npm alias of
`@bryntum/taskboard-trial@7.3.6`). Pronto runs 6.3.4 thin packages; TaskBoard is not on
Pronto's Bryntum licence yet. When it is, change the alias in `web/package.json` to the
licensed package (or the thin package next to the others in `pulse-bryntum`); no import
changes are needed. The trial shows a watermark.

## BRD coverage (v0.1, 10 Sep 2026)

| BRD | Where |
|---|---|
| BR-02 shared ranking, BR-03 seed Priority > Due Date > Created | `server/rank/rank.js` (id stands in for created date, which the tickets payload lacks) |
| BR-04 status by drag, BR-05 visible columns remembered | `board.config.ts`, prefs API |
| BR-06 grouping None / User / Department / Project, plus Priority (P1, P2, P3, No priority) | `model.ts` (`laneKeys`); departments from the users API |
| BR-07 movement rules: User lanes reassign, Priority lanes set the priority (`POST /api/kanban/priority`, kept as an override like status), Department/Project lanes block vertical drag | `board.config.ts` (`beforeTaskDrop`, `taskDrop`) |
| AC-07.3 / C-02 one task in several lanes | one card record per lane sharing `taskId` |
| BR-08/09 saved, shareable views restoring filters, columns, grouping, list / Kanban mode | `/api/kanban/views`, `?view=<id>`; the address bar also carries the whole configuration (`web/src/chrome/urlState.ts`), so a copied URL reproduces the view through the viewer's own permissions |
| BR-10 guardrails: office default, recency window, cap, notice | `routes/tasks.js` (`applyGuardrails`); they step aside as soon as the user applies a preset or a filter (`userHasFiltered`); the notice is a 10-second toast on load and a line in the (i) popover (`TaskWorkspace.tsx`) |
| BR-11 quick search over the active dataset | client-side `matchesSearch` |
| BR-12 compact cards, hover preview | one card per row, two-row template (`card.ts`); the card size selector was removed on 14 Sep; hover preview after 1.4s (`cardPreview`) |
| BR-06 grouped boards open with only the first swimlane expanded; expand / collapse all toggle in the strip; a column inside a swimlane is capped at 400px and scrolls | `TaskWorkspace.tsx` (`collapsedLanes`), `board.config.ts` (`setAllLanesCollapsed`) |
| Performance on grouped boards: only expanded lanes hold cards (lane-lazy loading); header counts from the full list | `web/src/kanban/lanes.ts` (`LaneSource`), wired in `board.config.ts` |
| BR-13 parent / subtask marker | `isParent`, `parentId` chips |
| BR-15 live updates | Pusher channel `private-kanban` (`server/realtime.js`, `web/src/realtime.ts`); periodic refresh stands in for Pronto-originated changes (BR-14) |

## Ordering: one global rank per task

From the "Spike: Global Task Order" on the Kanban Enhancements project (#73546):

1. Every task has **one rank**, independent of status and of which board shows it.
   Columns sort by rank; filtering never re-ranks anything.
2. The rank is **seeded** from data the task already has, so 200,000 existing tasks
   need no backfill: Priority (P1, P2, P3, then unset) as the outer block, then due date
   (soonest first), otherwise a "no due date" block, newest first. The task id is folded
   in as a tie-breaker, so two tasks due the same day never collide.
3. A drag and drop writes **one value**: the moved task's rank becomes the midpoint of
   its new neighbours. Moving to another column also writes the status. Nothing else in
   the column is touched.
4. Midpoints halve the gap each time; when a gap is exhausted (`rebalance: true` in the
   move response) the column neighbourhood is re-spaced in one small batch. With the
   seed spacing used (seconds) that takes about 40 consecutive drops into the same gap.

End state in Pronto: `kanban_rank DOUBLE NULL` on the task table, index `(status,
kanban_rank)`; NULL means "use the seed", computable in SQL:

```sql
COALESCE(kanban_rank,
  (CASE priority_new WHEN 1 THEN 0 WHEN 2 THEN 1 WHEN 3 THEN 2 ELSE 3 END) * 1e11
  + IF(enddate IS NULL, 1e10 + (1e8 - id), UNIX_TIMESTAMP(enddate) + id / 1e4))
```

Redis is a cache in front of that, never the source of truth. TaskBoard's own `weight`
field is set to the rank, so Bryntum's ordering and the persisted order never disagree.

## Data

- Tasks: `GET /v2/api/bryntum/tickets` (the Task Explorer query). Unscoped queries need
  `is_paginate=1`; paging is `page[limit]` + `page[page]`. Filter keys accepted by the
  API: `search, status, assignees, tags, show_all_tags_only, show_escalated_ticket,
  reported_by, ticket_type, departments, start_date, end_date, preset, parent_ticket_id,
  user_groups, priority_new, brands, jobs, clients, brand_categories, products,
  job_statuses, tasks, show_tasks_starred, show_tasks_stakeholder`.
- Status change: the legacy `api.v2.php action=tasks&type=update-property` call the
  current Kanban makes. Off by default (`KANBAN_WRITE_STATUS=0`): the demo keeps the new
  status as an override so nothing on Beta is mutated.
- Jobs: `GET /v2/api/jobs/{id}` (cached a day, `server/directory.js`) supplies the
  project code shown on cards (`jobExtension`), the Project Manager, brand and office of
  each task's project. The Project Manager filter is applied after the fetch (it is not a
  tickets-API key); Brand and Office map to the API's `brands` / `clients` keys.
- Filter facts verified against Beta on 14 Sep: `filter[assignees][]` also matches tasks
  assigned to a user group the person belongs to, so the explicit Assigned Users filter is
  re-applied strictly after the fetch (direct assignment only; the "Tasks Assigned to Me"
  preset keeps Pronto's group semantics). `filter[priority_new]` must be a single value,
  not a list. `filter[tags][]` takes tag ids (`tags_for_ticket[].tagid`), not names.
  `filter[ticket_type][]` takes numeric type ids the payload does not expose, so Task Type
  is not offered. Brands, clients, status, search, escalated, reported_by, start/end dates
  and parent_ticket_id behave as expected.
- "Updated within" (`filter[updated_from]`, `filter[updated_to]`, last activity) is applied
  after the fetch like Project Manager: the tickets API has no activity-date key. When the
  guardrails narrow a view, the office and the recency window they applied appear in the
  flyout and as chips; the first filter change the user makes turns them into explicit
  filters, so the view stays inside that office and window unless the user removes them.
- Filter pick-lists: `GET /api/tasks/options` derives assignees, project managers,
  offices, brands, tags and statuses from the tasks the user can see. Pronto's own lookup
  endpoints replace this in the product.
- Status list: Pronto's JSON API has no task-status resource (`/v2/api/statuses` is the
  batch-job status table; nothing under `tickets/` or `tasks/` lists them). Beta renders
  the list into its Task Explorer page as `pulse.request.formOptions.statuses`
  (`id, title, hex_colour`), so `server/fixtures/statuses.json` is a snapshot of that
  list (60 statuses, 14 Sep 2026). `server/statuses.js` merges the statuses seen on the
  loaded tasks on top of it, so a status added later still appears once a task has it.
  Replace the snapshot with the real endpoint when Pronto exposes one.
- Columns: every status in the catalogue is offered in the Columns menu (with its count
  in the loaded set, 0 included) and in the status filter. With no choice made, the board
  shows the five most populated statuses of the current view, leaving out Completed,
  Cancelled, Deleted, "Don't Use", On hold / Started - On Hold and Parent (ties keep the
  workflow order; `pickTopColumns` in `web/src/kanban/model.ts`). The first change in the
  Columns menu or a column header turns that pick into an explicit list, saved per user
  per board (`shownStatuses`), in the URL (`show=`) and in saved views; "Top 5" in the
  menu goes back to the automatic pick. A chosen column stays on the board even with no
  task in it, so tasks can be moved into it. The Parent status is a container: nothing
  can be dropped into its column.
- Column width: 300px when five columns fit the board; otherwise the columns shrink (to
  180px at least) so five fit, and below 266px the cards switch to the medium template
  (`cardSizes`): `fitColumns` in `board.config.ts`, applied on resize by `KanbanBoard.tsx`.
- Board height follows the window: the board ends just above the bottom of the browser so
  its horizontal scrollbar is always in view (`useFitToViewport` in `TaskWorkspace.tsx`).

## Performance with large lists

- Guardrails (BR-10) keep a Task Explorer board at `KANBAN_SAFE_THRESHOLD` tasks (default
  300) unless the user filters or asks for everything.
- The render window (`lanes.ts`, `LaneSource`) decides which of the loaded tasks are in
  TaskBoard's store and in the DOM:
  - Lane-lazy loading: only the expanded swimlanes have cards. A board with 3,000 tasks in
    40 lanes renders only the open lane. When a lane opens, its cards are added, taking
    status / rank / assignees from any sibling card of the same task already on the board.
  - Per-column paging: each column (per lane) shows its first `COLUMN_PAGE` (100) cards by
    rank and a "Show N more" card at the bottom that reveals the next page. Nothing is
    dropped: the full list stays loaded, header counts, search and filters see everything;
    only the rendering is paged. In production this is one query per column (`ORDER BY
    kanban_rank LIMIT n OFFSET m` on the `(status, kanban_rank)` index), so the board never
    holds more than columns x page cards whatever the dataset.
  - Counts in lane and column headers come from the full list.
- Flat boards with more than 400 cards in the window use TaskBoard's own `virtualize`
  (card contents drawn only for the visible part of each column). It is not used with
  swimlanes: its height estimate is taken while lanes are collapsed and expanded lanes come
  out a few pixels tall. TaskBoard's column toolbars are off: one widget per column per
  lane made a 26-lane board twice as slow to open.
- Measured (headless Chromium, 1,556 tasks, 20 columns): flat board first cards in about
  1s with 1.1s of main-thread work; grouped board (26 lanes, first lane open) 1.7s. The
  remaining fixed cost is TaskBoard creating a column element per lane per column.
- **Trial watermark.** Switching a 1,300-task board to User grouping (56 lanes x 38
  columns = 2,128 cells) took 19s in the profiler; 17s of it was the trial package's
  `setWaterMark`, which builds a data-URL SVG background per cell (plus `btoa`, `URL`,
  `queryString`). Its cost grows faster than the cell count (1,120 cells: 5s). The licensed
  package has no watermark, so this cost disappears with the licence; until then keep
  grouped views to the columns in use. The automatic column pick (five most populated
  statuses) keeps the cell count low on grouped boards; chosen columns are shown as chosen.
- Live updates (Pusher) are not a factor: the client only listens, and the two-minute
  refresh now compares a fingerprint of the response and touches nothing when the board
  is unchanged.
- Avatars are initials in a coloured circle, no image requests (1,500 cards would mean
  1,500 avatar fetches).
- Cards are two rows of static HTML; `useDomTransition` is off; the initial task list is
  loaded once (the wrapper skips the duplicate load React effects would otherwise cause).
- Beyond this, the scalable answer is per-column paging: load the top N cards of each
  column by rank (index `(status, kanban_rank)`) with "show more" at the bottom of a column,
  so the board never holds more than columns x N cards regardless of dataset size.
- Fixtures: `server/fixtures/*.json` are compact captures from Beta (explorer sample and
  project 1530) used when `KANBAN_FIXTURES=1` or there is no Pronto session.

## Run locally

```bash
npm install
cp .env.example .env            # defaults to fixtures + Beta
npm run dev                     # API on :8791, Vite on :5174 (proxies /api and /base)
npm test                        # rank unit tests
```

`npm run build && npm start` serves the built front end from the API process.

## Deploy (Vercel)

1. Import the repo. Build settings come from `vercel.json`.
2. Storage: add **Upstash Redis** from the Marketplace (sessions, ranks, prefs). Set
   `KV_PREFIX=kanban:` if it shares the SOW Planner's database.
3. Environment variables: `PRONTO_BASE_URL`, `PRONTO_ENVIRONMENTS`, `KANBAN_FIXTURES=0`,
   `KANBAN_WRITE_STATUS=0`, `KANBAN_SAFE_THRESHOLD` / `KANBAN_RECENCY_DAYS` (guardrails),
   `KANBAN_MAX_TASKS` (default 1500 per query), and the `PUSHER_*` set for live updates.

## Layout

```
api/index.js                Vercel entry (exports the Express app)
server/app.js               Express app: /api/auth, /api/tasks, /api/kanban, /api/health
server/index.js             long-lived process (local dev, Docker)
server/{config,kv,session,users}.js   auth + sessions, carried over from the SOW Planner
server/pronto.js            the only file that knows Pronto URL shapes
server/statuses.js          column catalogue and workflow order
server/rank/                rank maths, prototype store, tests
server/directory.js         user office + department lookups (cached)
server/realtime.js          Pusher-protocol publish + private channel auth
server/routes/tasks.js      GET /api/tasks (presets, filters, rank merge)
server/routes/kanban.js     POST /api/kanban/move, /rebalance, prefs, reset
server/fixtures/            captured Beta data for offline work
web/src/kanban/             the board (lift this)
web/src/chrome/             Pronto page chrome for the demo
web/src/pages/              Task Explorer / Project Kanban workspace
pronto-base/                shared nav package (copied into web/public/base at build)
```
