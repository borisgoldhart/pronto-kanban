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
| BR-06 grouping None / User / Department / Project | `model.ts` (`laneKeys`); departments from the users API |
| BR-07 movement rules: User lanes reassign, Department/Project lanes block vertical drag | `board.config.ts` (`beforeTaskDrop`, `taskDrop`) |
| AC-07.3 / C-02 one task in several lanes | one card record per lane sharing `taskId` |
| BR-08/09 saved, shareable views restoring filters, columns, grouping | `/api/kanban/views`, `?view=<id>` |
| BR-10 guardrails: office default, recency window, cap, notice | `routes/tasks.js` (`applyGuardrails`); they step aside as soon as the user applies a preset or a filter (`userHasFiltered`); notice in `TaskWorkspace.tsx` |
| BR-11 quick search over the active dataset | client-side `matchesSearch` |
| BR-12 compact cards, zoom, hover preview | zoom = card size levels large / medium / small, each a different card template via TaskBoard `cardSizes` + `tasksPerRow` (the pattern of Bryntum's zooming demo, not CSS scaling): `board.config.ts` (`ZOOM_LEVELS`), `card.ts` (`cardTitle`/`cardMeta` per size, `cardPreview`) |
| BR-06 grouped boards open with only the first swimlane expanded; Expand all / Collapse all in the strip | `TaskWorkspace.tsx` (`collapsedLanes`), `board.config.ts` (`setAllLanesCollapsed`) |
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
- Filter pick-lists: `GET /api/tasks/options` derives assignees, project managers,
  offices, brands, tags and statuses from the tasks the user can see. Pronto's own lookup
  endpoints replace this in the product.
- Columns: derived from the statuses present in the loaded tasks (id, name, colour),
  ordered by the workflow order in `server/statuses.js`. Completed / Cancelled / Deleted /
  Parent are hidden by default; the Columns menu in the control strip changes that, saved
  per user per board. Column headers carry no menu or collapse control.
- Board height follows the window: the board ends just above the bottom of the browser so
  its horizontal scrollbar is always in view (`useFitToViewport` in `TaskWorkspace.tsx`).

## Performance with large lists

- Guardrails (BR-10) keep a Task Explorer board at `KANBAN_SAFE_THRESHOLD` tasks (default
  300) unless the user filters or asks for everything.
- Grouped boards are lane-lazy (`lanes.ts`): only the expanded swimlanes have cards in
  TaskBoard's store and in the DOM. A board with 3,000 tasks in 40 lanes renders only the
  open lane. Counts in lane and column headers come from the full list. When a lane opens,
  its cards are added, taking status / rank / assignees from any sibling card of the same
  task already on the board.
- Flat boards above 400 cards use TaskBoard's own `virtualize` (cards rendered only for the
  visible part of each column). It is not used with swimlanes: its height estimate is taken
  while lanes are collapsed and expanded lanes come out a few pixels tall.
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
