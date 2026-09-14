/**
 * Bryntum TaskBoard configuration for the Pronto Kanban.
 *
 * Everything Bryntum-specific about the board is here: fields, columns, swimlanes,
 * card items, hover preview, features and drag handling. KanbanBoard.tsx only owns the
 * lifecycle (create / update / destroy) and hands changes to the caller.
 *
 * Movement rules (BRD BR-07 / C-03):
 *   - horizontal drag between status columns changes the status (any grouping);
 *   - vertical drag between User lanes reassigns the task (from -> to);
 *   - vertical drag between Department, Project or Brand lanes is refused.
 * A task shown in several lanes is several card records sharing a taskId; a change is
 * applied to every card that carries the taskId.
 *
 * Verified against @bryntum/taskboard 7.3.6 (types in node_modules/@bryntum/taskboard/taskboard.d.ts).
 */
import { Tooltip } from "@bryntum/taskboard";
import type { ColumnModel, TaskBoard, TaskBoardConfig, TaskModel, TaskStore } from "@bryntum/taskboard";

/**
 * Bryntum's shared tooltip pops up the full text of any overflowing element it finds while
 * walking up from the hovered node (its `filterTarget`), which is a second hover on every
 * truncated card title. `Tooltip.showOverflow = false` does not hold (the library resets
 * it during lazy initialisation), so the shared instance's target filter is replaced with
 * one that only honours explicit `data-btip` targets. The delayed hover preview is then
 * the only hover on a card. Verified against @bryntum/taskboard 7.3.6.
 */
let overflowTipDisabled = false;
function disableOverflowTooltip() {
  if (overflowTipDisabled) return;
  overflowTipDisabled = true;
  const shared = Tooltip.tooltip as unknown as { forSelector?: string; filterTarget?: (e: { target: Element }) => Element | null };
  if (!shared) return;
  const selector = shared.forSelector || "[data-btip]";
  shared.filterTarget = ({ target }) => target.closest(selector);
}
import { cardMeta, cardPreview, cardTitle, statusPill } from "./card";
import { rankBetween } from "./rank";
import { UNASSIGNED_LANE, priorityOfLane, type BoardColumn, type BoardLane, type BoardTask, type GroupBy } from "./model";
import { LaneSource, isMoreCard, setCountInDomConfig } from "./lanes";

export type MoveRequest = { taskId: number; fromStatus: string; statusId: string; prevRank: number | null; nextRank: number | null };
export type MoveResponse = { rank: number; rebalance: boolean };
export type ReassignRequest = { taskId: number; fromUserId: number | null; toUserId: number | null; toUserName: string; assignees: BoardTask["assignees"] };
export type PriorityRequest = { taskId: number; fromPriority: number; priority: number };

export type BoardCallbacks = {
  /** Persist one drop. Return the authoritative rank. */
  onMove: (req: MoveRequest) => Promise<MoveResponse>;
  /** Re-space a column neighbourhood when a gap is exhausted. */
  onRebalance?: (ranks: { id: number; rank: number }[]) => Promise<{ id: number; rank: number }[]>;
  /** A card was dragged between User lanes: persist the new assignee list. */
  onReassign?: (req: ReassignRequest) => Promise<void>;
  /** A card was dragged between Priority lanes: persist the new priority. */
  onSetPriority?: (req: PriorityRequest) => Promise<void>;
  /** Open the task (double-click, menu). */
  onOpen: (task: BoardTask) => void;
  /** The user hid a column from its header menu. */
  onHideColumn?: (statusId: string) => void;
};

export type BoardOptions = {
  tasks: BoardTask[];
  columns: BoardColumn[];
  lanes: BoardLane[];          // empty = no swimlanes
  groupBy: GroupBy;
  showProjectOnCards: boolean;
  collapsedLanes?: Set<string>; // swimlanes to start collapsed
  columnWidth?: number;
  callbacks: BoardCallbacks;
};

/**
 * Column width. One card per row. Columns are 300px on a wide screen; on a narrower
 * board they shrink (to 200px at least) so that five columns fit, and below MEDIUM_BREAK
 * the card switches to the medium template through TaskBoard's `cardSizes` (fewer chips,
 * two avatars). See `fitColumns` and KanbanBoard.tsx.
 */
export const COLUMN_WIDTH = 300;
export const COLUMN_MIN_WIDTH = 180;
export const COLUMNS_TO_FIT = 5;
export const COLUMN_GAP = 11;              // --b-task-board-column-gap (0.85em at 13px)
const MEDIUM_BREAK = 266;                  // column width below which cards use the medium template

/** Width for the columns so that COLUMNS_TO_FIT of them fit in `boardWidth`, within the limits. */
export function fitColumns(boardWidth: number): number {
  if (!boardWidth) return COLUMN_WIDTH;
  const w = Math.floor((boardWidth - COLUMN_GAP * (COLUMNS_TO_FIT - 1) - 12) / COLUMNS_TO_FIT);
  return Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_WIDTH, w));
}

/** Card template per card width (one card per row, so card width tracks column width). */
const CARD_SIZES = (showProject: boolean) => [
  { name: "medium", maxWidth: MEDIUM_BREAK - 16, maxAvatars: 2, headerItems: { text: { template: ({ taskRecord }: { taskRecord: TaskModel }) => cardTitle(asTask(taskRecord), "medium") } }, bodyItems: { meta: { template: ({ taskRecord }: { taskRecord: TaskModel }) => cardMeta(asTask(taskRecord), { showProject, size: "medium" }) } } },
  { name: "large", maxAvatars: 3 },
];

/** The custom fields a card reads, declared so `record.<field>` works and changes track. */
export const TASK_FIELDS = [
  "taskId", "rank", "lane", "jobId", "jobTitle", "jobCode", "projectManager", "brand", "client", "assignees", "departments", "tags",
  "priority", "escalated", "starred", "startDate", "endDate", "isParent", "parentTaskId", "parentTitle", "activity", "seeded", "statusOverridden", "moreCount",
];

export function toTaskData(t: BoardTask): Record<string, unknown> {
  return { ...t };
}

const asTask = (r: TaskModel) => r as unknown as BoardTask & TaskModel;

/** The live task store (typed loosely in the config union). */
export const taskStoreOf = (board: TaskBoard) => board.project.taskStore as TaskStore;

/** Every card record for a task (one per lane it appears in). */
export function cardsOf(board: TaskBoard, taskId: number): (BoardTask & TaskModel)[] {
  const out: (BoardTask & TaskModel)[] = [];
  taskStoreOf(board).forEach((r) => { const t = asTask(r as TaskModel); if (t.taskId === taskId) out.push(t); });
  return out;
}

/** Cards in one column (and lane), in display order. */
export function columnTasks(board: TaskBoard, column: ColumnModel, lane: string | null): (BoardTask & TaskModel)[] {
  const status = String(column.id);
  const rows: (BoardTask & TaskModel)[] = [];
  taskStoreOf(board).forEach((r) => {
    const t = asTask(r as TaskModel);
    if (String(t.status) === status && (lane === null || t.lane === lane) && !isMoreCard(t)) rows.push(t);
  });
  rows.sort((a, b) => (a.weight - b.weight) || (a.taskId - b.taskId));
  return rows;
}

export function buildBoardConfig(el: HTMLElement, opts: BoardOptions): Partial<TaskBoardConfig> {
  const { callbacks, groupBy } = opts;
  const useLanes = opts.lanes.length > 0;
  const laneName = new Map(opts.lanes.map((l) => [l.id, l.text]));
  const columnById = new Map(opts.columns.map((c) => [c.id, c]));

  // Status and lane of each card when its drag started (TaskBoard has already applied
  // the new column and lane by the time taskDrop fires).
  const dragOrigin = new WeakMap<object, { status: string; lane: string }>();

  // The render window (lanes.ts): expanded lanes only, and the first page of each column.
  const laneSource = new LaneSource(opts.tasks, useLanes ? opts.lanes.map((l) => l.id).filter((id) => !opts.collapsedLanes?.has(id)) : [""]);
  const initialTasks = laneSource.visible();

  const config: Partial<TaskBoardConfig> = {
    appendTo: el,
    cls: useLanes ? "pk-board pk-board--lanes pk-board--lazy" : "pk-board pk-board--lazy",
    columnField: "status",
    swimlaneField: useLanes ? "lane" : undefined,
    // Column headers: the status pill and count only (no collapse chevron, no menu).
    columns: opts.columns.map((c) => ({ id: c.id, text: c.text, color: c.color, hidden: c.hidden, width: opts.columnWidth ?? COLUMN_WIDTH, minWidth: COLUMN_MIN_WIDTH, htmlEncodeHeaderText: false, collapsible: false })),
    swimlanes: useLanes ? opts.lanes.map((l) => ({ id: l.id, text: l.text, collapsible: true, collapsed: opts.collapsedLanes?.has(l.id) ?? false })) : undefined,
    // Header counts come from the full task list, not from what is loaded (lazy lanes render
    // their own column count next to the pill; Bryntum's store-based one is hidden by CSS).
    columnTitleRenderer: ({ columnRecord }) => statusPill(columnRecord.text, String(columnRecord.color || "#999"))
      + `<span class="pk-col-count" data-col="${String(columnRecord.id)}">${laneSource.columnCount(String(columnRecord.id))}</span>`,
    showCountInHeader: true,
    ...(useLanes ? { swimlaneRenderer: ({ swimlaneRecord, swimlaneConfig }: { swimlaneRecord: { id: string | number }; swimlaneConfig: unknown }) => { setCountInDomConfig(swimlaneConfig, "b-task-board-swimlane-count", `(${laneSource.laneCount(String(swimlaneRecord.id))})`); } } : {}),
    showCollapseInHeader: true,        // swimlanes only: columns are not collapsible and their header icons are hidden
    stickyHeaders: true,
    tasksPerRow: 1,
    cardSizes: CARD_SIZES(opts.showProjectOnCards) as unknown as TaskBoardConfig["cardSizes"],
    stretchCards: true,
    virtualize: !useLanes && initialTasks.length > 400,   // virtualised column bodies mis-size expanded swimlanes; lanes stay unvirtualised
    useDomTransition: false,
    project: {
      taskStore: { fields: TASK_FIELDS, data: initialTasks.map(toTaskData) },
    },
    // Card: two rows only. Default items (text, description, avatars) are switched off.
    headerItems: { text: { type: "template", template: ({ taskRecord }) => cardTitle(asTask(taskRecord), "large") } },
    bodyItems: { text: { hidden: true }, meta: { type: "template", template: ({ taskRecord }) => cardMeta(asTask(taskRecord), { showProject: opts.showProjectOnCards, size: "large" }) } },
    // The "Show more" card at the end of a paged column is a card record too (lanes.ts), so
    // TaskBoard keeps it in the flow; it only needs a class to look like a control.
    taskRenderer: ({ taskRecord, cardConfig }) => {
      if (!isMoreCard(asTask(taskRecord))) return;
      const cfg = cardConfig as { class?: Record<string, boolean> };
      cfg.class = { ...(cfg.class || {}), "pk-card--more": true };
    },
    footerItems: { resourceAvatars: { hidden: true } },
    features: {
      columnDrag: true,
      taskDrag: true,
      taskEdit: false,
      simpleTaskEdit: false,
      columnToolbars: false,       // one toolbar widget per column per lane is too costly on grouped boards; "Show more" is a card (lanes.ts)
      columnLock: false,
      // Hover preview (BR-12): the lightweight inspection step before Task Detail. The delay
      // keeps it out of the way while dragging; resting on a card for 1.4s is deliberate.
      taskTooltip: {
        tooltip: { hoverDelay: 1400 },
        template: ({ taskRecord, columnRecord }) => {
          if (isMoreCard(asTask(taskRecord))) return "";
          const col = columnById.get(String(columnRecord?.id)) || { text: String(columnRecord?.text || ""), color: String(columnRecord?.color || "#999") };
          return cardPreview(asTask(taskRecord), col.text, col.color);
        },
      },
      taskMenu: {
        items: {
          editTask: false, removeTask: false, resources: false, column: false, swimlane: false,
          openTask: { text: "Open in Pronto", icon: "b-fa b-fa-arrow-up-right-from-square", weight: 100, onItem: ({ taskRecord }: { taskRecord?: unknown }) => { if (taskRecord) callbacks.onOpen(asTask(taskRecord as TaskModel)); } },
        },
        processItems: ({ taskRecord }: { taskRecord?: unknown }) => !(taskRecord && isMoreCard(asTask(taskRecord as TaskModel))),
      },
      // Column header ellipsis: hide this column (the Columns menu in the strip brings it back).
      columnHeaderMenu: {
        items: {
          addTask: false, moveColumnLeft: false, moveColumnRight: false,
          hideColumn: { text: "Hide column", icon: "b-fa b-fa-eye-slash", weight: 100, onItem: ({ columnRecord }: { columnRecord?: unknown }) => { if (columnRecord) callbacks.onHideColumn?.(String((columnRecord as ColumnModel).id)); } },
        },
      },
    },
    listeners: {
      beforeTaskDrag: ({ taskRecords }) => !taskRecords.some((r) => isMoreCard(asTask(r))),
      taskClick: ({ source, taskRecord }) => { const t = asTask(taskRecord); if (isMoreCard(t)) { LaneSource.of(source as TaskBoard)?.showMore(source as TaskBoard, t.lane, t.status); return false; } },
      swimlaneExpand: ({ source, swimlaneRecord }) => laneSource.expand(source as TaskBoard, String(swimlaneRecord.id)),
      swimlaneCollapse: ({ source, swimlaneRecord }) => laneSource.collapse(source as TaskBoard, String(swimlaneRecord.id)),
      taskDragStart: ({ taskRecords }) => { for (const r of taskRecords) { const t = asTask(r); dragOrigin.set(r, { status: String(t.status), lane: String(t.lane) }); } },
      // Vertical moves: User lanes (reassignment) and Priority lanes (priority change) have a
      // business meaning; Department, Project and Brand lanes do not (a task's project, and so
      // its brand, is not changed from a board), so a card stays in its lane there.
      beforeTaskDrop: ({ taskRecords, targetColumn, targetSwimlane }) => {
        // The Parent status is a container, not a workflow step: nothing is dropped into it.
        if (targetColumn && columnById.get(String(targetColumn.id))?.isParent) return false;
        if (!targetSwimlane) return true;
        if (groupBy === "user" || groupBy === "priority") return true;
        return taskRecords.every((r) => asTask(r).lane === String(targetSwimlane.id));
      },
      taskDrop: async ({ source, taskRecords, targetColumn, targetSwimlane }) => {
        const board = source as TaskBoard;
        const lane = targetSwimlane ? String(targetSwimlane.id) : null;
        for (const record of taskRecords) {
          const task = asTask(record);
          const origin = dragOrigin.get(record) ?? { status: String(task.status), lane: String(task.lane) };
          const targetStatus = String(targetColumn.id);

          // 1. Reassignment when the card crossed User lanes.
          if (groupBy === "user" && lane !== null && lane !== origin.lane && callbacks.onReassign) {
            const fromUserId = origin.lane === UNASSIGNED_LANE ? null : Number(origin.lane);
            const toUserId = lane === UNASSIGNED_LANE ? null : Number(lane);
            const current = task.assignees.filter((a) => a.id !== fromUserId);
            if (toUserId && !current.some((a) => a.id === toUserId)) current.push({ id: toUserId, name: laneName.get(lane) || `User ${toUserId}`, avatar: null, avatarUrl: null });
            // If the task already had a card in the target lane, this card is a duplicate.
            const twin = cardsOf(board, task.taskId).find((c) => c !== task && c.lane === lane);
            for (const c of cardsOf(board, task.taskId)) c.set({ assignees: current });
            if (twin) taskStoreOf(board).remove(record);
            try { await callbacks.onReassign({ taskId: task.taskId, fromUserId, toUserId, toUserName: laneName.get(lane) || "", assignees: current }); }
            catch (e) { console.error("[kanban] reassign failed", e); }
            if (twin) continue;   // the surviving twin keeps its rank and status
          }

          // 1b. Priority when the card crossed Priority lanes (a task is in exactly one lane, so no twin).
          if (groupBy === "priority" && lane !== null && lane !== origin.lane && callbacks.onSetPriority) {
            const priority = priorityOfLane(lane);
            record.set({ priority, lane });
            laneSource.relane(task.id, lane);
            try { await callbacks.onSetPriority({ taskId: task.taskId, fromPriority: priorityOfLane(origin.lane), priority }); }
            catch (e) { console.error("[kanban] priority change failed", e); }
          }
          if (groupBy === "user" && lane !== null && lane !== origin.lane) laneSource.relane(task.id, lane);

          // 2. Rank (and status) for the drop position.
          const rows = columnTasks(board, targetColumn, lane);
          const idx = rows.findIndex((r) => r.id === task.id);
          const prev = idx > 0 ? rows[idx - 1] : null;
          const next = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;
          const prevRank = prev ? prev.rank : null;
          const nextRank = next ? next.rank : null;
          // A lane-only move into an empty cell (same status, no neighbours) leaves the global rank alone.
          if (!prev && !next && targetStatus === origin.status) continue;
          const optimistic = rankBetween(prevRank, nextRank);
          for (const c of cardsOf(board, task.taskId)) c.set({ rank: optimistic.rank, weight: optimistic.rank, status: targetStatus });
          for (const r of rows) if (r.taskId !== task.taskId && r.weight !== r.rank) r.set({ weight: r.rank });
          try {
            const res = await callbacks.onMove({ taskId: task.taskId, fromStatus: origin.status, statusId: targetStatus, prevRank, nextRank });
            for (const c of cardsOf(board, task.taskId)) c.set({ rank: res.rank, weight: res.rank, seeded: false });
            if (res.rebalance && callbacks.onRebalance) {
              const ordered = columnTasks(board, targetColumn, lane).map((r) => ({ id: r.taskId, rank: r.rank }));
              const fresh = await callbacks.onRebalance(ordered);
              for (const f of fresh) for (const c of cardsOf(board, f.id)) c.set({ rank: f.rank, weight: f.rank });
            }
          } catch (e) {
            console.error("[kanban] move failed", e);
          }
        }
      },
      taskDblClick: ({ taskRecord }) => { if (!isMoreCard(asTask(taskRecord))) callbacks.onOpen(asTask(taskRecord)); },
    },
  };
  pendingSources.set(config, laneSource);
  return config;
}

/** Called by the wrapper once the board exists, so lanes.ts can find the source for it. */
export function attachLaneSource(board: TaskBoard, config: Partial<TaskBoardConfig>) {
  void config;
  const src = pendingSources.get(config);
  if (src) { src.attach(board); pendingSources.delete(config); }
  disableOverflowTooltip();
}
const pendingSources = new WeakMap<object, LaneSource>();

/** Expand or collapse every swimlane in place (loading or dropping their cards when lanes are lazy). */
export function setAllLanesCollapsed(board: TaskBoard, collapsed: boolean) {
  const lanes = board.swimlanes as unknown as { forEach: (fn: (r: { id: string | number; collapsed: boolean }) => void) => void } | undefined;
  const src = LaneSource.of(board);
  lanes?.forEach((r) => {
    if (src) { if (collapsed) src.collapse(board, String(r.id)); else src.expand(board, String(r.id)); }
    if (r.collapsed !== collapsed) r.collapsed = collapsed;
  });
}

/** Push a new task list into the board (lazy lanes keep only the expanded lanes loaded). */
export function setBoardTasks(board: TaskBoard, tasks: BoardTask[]) {
  const src = LaneSource.of(board);
  if (src) {
    src.setTasks(board, tasks);
    for (const el of board.element.querySelectorAll<HTMLElement>(".pk-col-count[data-col]")) el.textContent = String(src.columnCount(el.dataset.col || ""));
  } else taskStoreOf(board).data = tasks.map(toTaskData);
}



/** Apply a change that arrived from another user (realtime) to every card of a task. */
export function applyRemoteChange(board: TaskBoard, taskId: number, patch: { rank?: number; status?: string }) {
  for (const c of cardsOf(board, taskId)) {
    const p: Record<string, unknown> = {};
    if (typeof patch.rank === "number") { p.rank = patch.rank; p.weight = patch.rank; p.seeded = false; }
    if (patch.status) p.status = patch.status;
    c.set(p);
  }
}
