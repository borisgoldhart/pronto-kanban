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
 *   - vertical drag between Department or Project lanes is refused.
 * A task shown in several lanes is several card records sharing a taskId; a change is
 * applied to every card that carries the taskId.
 *
 * Verified against @bryntum/taskboard 7.3.6 (types in node_modules/@bryntum/taskboard/taskboard.d.ts).
 */
import type { ColumnModel, TaskBoard, TaskBoardConfig, TaskModel, TaskStore } from "@bryntum/taskboard";
import { cardMeta, cardPreview, cardTitle, statusPill } from "./card";
import { rankBetween } from "./rank";
import { UNASSIGNED_LANE, type BoardColumn, type BoardLane, type BoardTask, type GroupBy } from "./model";

export type MoveRequest = { taskId: number; fromStatus: string; statusId: string; prevRank: number | null; nextRank: number | null };
export type MoveResponse = { rank: number; rebalance: boolean };
export type ReassignRequest = { taskId: number; fromUserId: number | null; toUserId: number | null; toUserName: string; assignees: BoardTask["assignees"] };

export type BoardCallbacks = {
  /** Persist one drop. Return the authoritative rank. */
  onMove: (req: MoveRequest) => Promise<MoveResponse>;
  /** Re-space a column neighbourhood when a gap is exhausted. */
  onRebalance?: (ranks: { id: number; rank: number }[]) => Promise<{ id: number; rank: number }[]>;
  /** A card was dragged between User lanes: persist the new assignee list. */
  onReassign?: (req: ReassignRequest) => Promise<void>;
  /** Open the task (double-click, menu). */
  onOpen: (task: BoardTask) => void;
};

export type BoardOptions = {
  tasks: BoardTask[];
  columns: BoardColumn[];
  lanes: BoardLane[];          // empty = no swimlanes
  groupBy: GroupBy;
  showProjectOnCards: boolean;
  zoom: number;                // ZOOM_LEVELS index
  collapsedLanes?: Set<string>; // swimlanes to start collapsed
  columnWidth?: number;
  callbacks: BoardCallbacks;
};

/**
 * Zoom (BR-12), the way Bryntum's "zooming" demo does it: the slider changes
 * `tasksPerRow`, cards get narrower, and `cardSizes` picks a different card template
 * per width band (large / medium / small). No CSS scaling: each level is a real
 * template, so small cards drop the chips that would not fit rather than shrinking them.
 */
export type ZoomLevel = { name: "large" | "medium" | "small"; label: string; tasksPerRow: number; columnWidth: number };
export const ZOOM_LEVELS: ZoomLevel[] = [
  { name: "large", label: "Large", tasksPerRow: 1, columnWidth: 300 },
  { name: "medium", label: "Medium", tasksPerRow: 2, columnWidth: 320 },
  { name: "small", label: "Small", tasksPerRow: 3, columnWidth: 340 },
];
export const DEFAULT_ZOOM = 0;
export const zoomLevel = (i: number): ZoomLevel => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i | 0))];

/** Width bands for cardSizes: with 1 / 2 / 3 cards per row in a ~300px column. */
const CARD_SIZES = (showProject: boolean) => [
  { name: "small", maxWidth: 125, maxAvatars: 1, headerItems: { text: { template: ({ taskRecord }: { taskRecord: TaskModel }) => cardTitle(asTask(taskRecord), "small") } }, bodyItems: { meta: { template: ({ taskRecord }: { taskRecord: TaskModel }) => cardMeta(asTask(taskRecord), { showProject: false, size: "small" }) } } },
  { name: "medium", maxWidth: 200, maxAvatars: 2, headerItems: { text: { template: ({ taskRecord }: { taskRecord: TaskModel }) => cardTitle(asTask(taskRecord), "medium") } }, bodyItems: { meta: { template: ({ taskRecord }: { taskRecord: TaskModel }) => cardMeta(asTask(taskRecord), { showProject, size: "medium" }) } } },
  { name: "large", maxAvatars: 3 },
];

/** The custom fields a card reads, declared so `record.<field>` works and changes track. */
export const TASK_FIELDS = [
  "taskId", "rank", "lane", "jobId", "jobTitle", "jobCode", "projectManager", "brand", "client", "assignees", "departments", "tags",
  "priority", "escalated", "starred", "startDate", "endDate", "isParent", "parentId", "activity", "seeded", "statusOverridden",
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
    if (String(t.status) === status && (lane === null || t.lane === lane)) rows.push(t);
  });
  rows.sort((a, b) => (a.weight - b.weight) || (a.taskId - b.taskId));
  return rows;
}

export function buildBoardConfig(el: HTMLElement, opts: BoardOptions): Partial<TaskBoardConfig> {
  const { callbacks, groupBy } = opts;
  const useLanes = opts.lanes.length > 0;
  const zoom = zoomLevel(opts.zoom);
  const laneName = new Map(opts.lanes.map((l) => [l.id, l.text]));
  const columnById = new Map(opts.columns.map((c) => [c.id, c]));

  // Status and lane of each card when its drag started (TaskBoard has already applied
  // the new column and lane by the time taskDrop fires).
  const dragOrigin = new WeakMap<object, { status: string; lane: string }>();

  const config: Partial<TaskBoardConfig> = {
    appendTo: el,
    cls: useLanes ? "pk-board pk-board--lanes" : "pk-board",
    columnField: "status",
    swimlaneField: useLanes ? "lane" : undefined,
    // Column headers: the status pill and count only (no collapse chevron, no menu).
    columns: opts.columns.map((c) => ({ id: c.id, text: c.text, color: c.color, hidden: c.hidden, width: opts.columnWidth ?? zoom.columnWidth, minWidth: 220, htmlEncodeHeaderText: false, collapsible: false })),
    swimlanes: useLanes ? opts.lanes.map((l) => ({ id: l.id, text: l.text, collapsible: true, collapsed: opts.collapsedLanes?.has(l.id) ?? false })) : undefined,
    columnTitleRenderer: ({ columnRecord }) => statusPill(columnRecord.text, String(columnRecord.color || "#999")),
    showCountInHeader: true,
    showCollapseInHeader: true,        // swimlanes only: columns are not collapsible and their header icons are hidden
    stickyHeaders: true,
    tasksPerRow: zoom.tasksPerRow,
    cardSizes: CARD_SIZES(opts.showProjectOnCards) as unknown as TaskBoardConfig["cardSizes"],
    stretchCards: true,
    virtualize: opts.tasks.length > 400,
    useDomTransition: false,
    project: {
      taskStore: { fields: TASK_FIELDS, data: opts.tasks.map(toTaskData) },
    },
    // Card: two rows only. Default items (text, description, avatars) are switched off.
    headerItems: { text: { type: "template", template: ({ taskRecord }) => cardTitle(asTask(taskRecord), "large") } },
    bodyItems: { text: { hidden: true }, meta: { type: "template", template: ({ taskRecord }) => cardMeta(asTask(taskRecord), { showProject: opts.showProjectOnCards, size: "large" }) } },
    footerItems: { resourceAvatars: { hidden: true } },
    features: {
      columnDrag: true,
      taskDrag: true,
      taskEdit: false,
      simpleTaskEdit: false,
      columnToolbars: false,
      columnLock: false,
      // Hover preview (BR-12): the lightweight inspection step before Task Detail.
      taskTooltip: {
        template: ({ taskRecord, columnRecord }) => {
          const col = columnById.get(String(columnRecord?.id)) || { text: String(columnRecord?.text || ""), color: String(columnRecord?.color || "#999") };
          return cardPreview(asTask(taskRecord), col.text, col.color);
        },
      },
      taskMenu: {
        items: {
          editTask: false, removeTask: false, resources: false, column: false, swimlane: false,
          openTask: { text: "Open in Pronto", icon: "b-fa b-fa-arrow-up-right-from-square", weight: 100, onItem: ({ taskRecord }: { taskRecord?: unknown }) => { if (taskRecord) callbacks.onOpen(asTask(taskRecord as TaskModel)); } },
        },
      },
      // Columns are chosen from the Columns menu in the control strip; no per-column menu.
      columnHeaderMenu: false,
    },
    listeners: {
      taskDragStart: ({ taskRecords }) => { for (const r of taskRecords) { const t = asTask(r); dragOrigin.set(r, { status: String(t.status), lane: String(t.lane) }); } },
      // Vertical moves: only User lanes have a business meaning (reassignment).
      beforeTaskDrop: ({ taskRecords, targetSwimlane }) => {
        if (!targetSwimlane) return true;
        if (groupBy === "user") return true;
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

          // 2. Rank (and status) for the drop position.
          const rows = columnTasks(board, targetColumn, lane);
          const idx = rows.findIndex((r) => r.id === task.id);
          const prev = idx > 0 ? rows[idx - 1] : null;
          const next = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;
          const prevRank = prev ? prev.rank : null;
          const nextRank = next ? next.rank : null;
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
      taskDblClick: ({ taskRecord }) => callbacks.onOpen(asTask(taskRecord)),
    },
  };
  return config;
}

/** Expand or collapse every swimlane in place. */
export function setAllLanesCollapsed(board: TaskBoard, collapsed: boolean) {
  const lanes = board.swimlanes as unknown as { forEach: (fn: (r: { collapsed: boolean }) => void) => void } | undefined;
  lanes?.forEach((r) => { if (r.collapsed !== collapsed) r.collapsed = collapsed; });
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
