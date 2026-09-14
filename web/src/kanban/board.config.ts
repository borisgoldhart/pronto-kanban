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
  /** The user hid a column from its header menu. */
  onHideColumn?: (statusId: string) => void;
};

export type BoardOptions = {
  tasks: BoardTask[];
  columns: BoardColumn[];
  lanes: BoardLane[];          // empty = no swimlanes
  groupBy: GroupBy;
  showProjectOnCards: boolean;
  columnWidth?: number;
  callbacks: BoardCallbacks;
};

/** The custom fields a card reads, declared so `record.<field>` works and changes track. */
export const TASK_FIELDS = [
  "taskId", "rank", "lane", "jobId", "jobTitle", "jobCode", "brand", "client", "assignees", "departments", "tags",
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
  const laneName = new Map(opts.lanes.map((l) => [l.id, l.text]));
  const columnById = new Map(opts.columns.map((c) => [c.id, c]));

  // Status and lane of each card when its drag started (TaskBoard has already applied
  // the new column and lane by the time taskDrop fires).
  const dragOrigin = new WeakMap<object, { status: string; lane: string }>();

  const config: Partial<TaskBoardConfig> = {
    appendTo: el,
    cls: "pk-board",
    columnField: "status",
    swimlaneField: useLanes ? "lane" : undefined,
    columns: opts.columns.map((c) => ({ id: c.id, text: c.text, color: c.color, hidden: c.hidden, width: opts.columnWidth ?? 300, minWidth: 220, htmlEncodeHeaderText: false, collapsible: true })),
    swimlanes: useLanes ? opts.lanes.map((l) => ({ id: l.id, text: l.text, collapsible: true })) : undefined,
    columnTitleRenderer: ({ columnRecord }) => statusPill(columnRecord.text, String(columnRecord.color || "#999")),
    showCountInHeader: true,
    showCollapseInHeader: true,
    stickyHeaders: true,
    tasksPerRow: 1,
    stretchCards: true,
    virtualize: opts.tasks.length > 400,
    useDomTransition: false,
    project: {
      taskStore: { fields: TASK_FIELDS, data: opts.tasks.map(toTaskData) },
    },
    // Card: two rows only. Default items (text, description, avatars) are switched off.
    headerItems: { text: { type: "template", template: ({ taskRecord }) => cardTitle(asTask(taskRecord)) } },
    bodyItems: { text: { hidden: true }, meta: { type: "template", template: ({ taskRecord }) => cardMeta(asTask(taskRecord), { showProject: opts.showProjectOnCards }) } },
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
      columnHeaderMenu: {
        items: {
          addTask: false, moveColumnLeft: false, moveColumnRight: false,
          hideColumn: { text: "Hide column", icon: "b-fa b-fa-eye-slash", weight: 100, onItem: ({ columnRecord }: { columnRecord?: unknown }) => { if (columnRecord) callbacks.onHideColumn?.(String((columnRecord as ColumnModel).id)); } },
        },
      },
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

/** Apply a change that arrived from another user (realtime) to every card of a task. */
export function applyRemoteChange(board: TaskBoard, taskId: number, patch: { rank?: number; status?: string }) {
  for (const c of cardsOf(board, taskId)) {
    const p: Record<string, unknown> = {};
    if (typeof patch.rank === "number") { p.rank = patch.rank; p.weight = patch.rank; p.seeded = false; }
    if (patch.status) p.status = patch.status;
    c.set(p);
  }
}
