/**
 * Bryntum TaskBoard configuration for the Pronto Kanban.
 *
 * Everything Bryntum-specific about the board is here: fields, columns, swimlanes,
 * card items, features and drag handling. KanbanBoard.tsx only owns the lifecycle
 * (create / update / destroy) and hands changes to the caller.
 *
 * Verified against @bryntum/taskboard 7.3.6 (types in node_modules/@bryntum/taskboard/taskboard.d.ts).
 */
import type { ColumnModel, TaskBoard, TaskBoardConfig, TaskModel, TaskStore } from "@bryntum/taskboard";
import { cardMeta, cardTitle, statusPill } from "./card";
import { rankBetween } from "./rank";
import type { BoardColumn, BoardLane, BoardTask } from "./model";

export type MoveRequest = { taskId: number; fromStatus: string; statusId: string; prevRank: number | null; nextRank: number | null; task: BoardTask };
export type MoveResponse = { rank: number; rebalance: boolean };

export type BoardCallbacks = {
  /** Persist one drop. Return the authoritative rank. */
  onMove: (req: MoveRequest) => Promise<MoveResponse>;
  /** Re-space a column neighbourhood when a gap is exhausted. */
  onRebalance?: (ranks: { id: number; rank: number }[]) => Promise<{ id: number; rank: number }[]>;
  /** Open the task (double-click, menu). */
  onOpen: (task: BoardTask) => void;
  /** The user hid a column from its header menu. */
  onHideColumn?: (statusId: string) => void;
};

export type BoardOptions = {
  tasks: BoardTask[];
  columns: BoardColumn[];
  lanes: BoardLane[];          // empty = no swimlanes
  showProjectOnCards: boolean;
  columnWidth?: number;
  callbacks: BoardCallbacks;
};

/** The custom fields a card reads, declared so `record.<field>` works and changes track. */
export const TASK_FIELDS = [
  "rank", "lane", "jobId", "jobTitle", "jobCode", "brand", "client", "assignees", "tags",
  "priority", "escalated", "starred", "endDate", "seeded", "statusOverridden",
];

export function toTaskData(t: BoardTask): Record<string, unknown> {
  return { ...t };
}

const asTask = (r: TaskModel) => r as unknown as BoardTask & TaskModel;

/** Plain snapshot of a record's fields (record properties are prototype getters, so a spread would miss them). */
const snapshot = (r: TaskModel): BoardTask => { const t = r as unknown as BoardTask & TaskModel; return { ...((r as unknown as { data: BoardTask }).data), id: Number(r.id), status: String(t.status), weight: t.weight, rank: t.rank }; };

/** The live task store (typed loosely in the config union). */
export const taskStoreOf = (board: TaskBoard) => board.project.taskStore as TaskStore;

/** Tasks in one column (and lane), in display order. */
export function columnTasks(board: TaskBoard, column: ColumnModel, lane: string | null): (BoardTask & TaskModel)[] {
  const status = String(column.id);
  const store = taskStoreOf(board);
  const rows: (BoardTask & TaskModel)[] = [];
  store.forEach((r) => {
    const t = asTask(r as TaskModel);
    if (String(t.status) === status && (lane === null || t.lane === lane)) rows.push(t);
  });
  rows.sort((a, b) => (a.weight - b.weight) || (Number(a.id) - Number(b.id)));
  return rows;
}

export function buildBoardConfig(el: HTMLElement, opts: BoardOptions): Partial<TaskBoardConfig> {
  const { callbacks } = opts;
  const useLanes = opts.lanes.length > 0;

  // Status of each card when its drag started (TaskBoard has already applied the new
  // column by the time taskDrop fires).
  const dragOrigin = new WeakMap<object, string>();

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
      taskTooltip: false,
      columnToolbars: false,
      columnLock: false,
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
      // Swimlanes describe an attribute of the task (project, assignee...) that a drag
      // must not change, so a drop is only valid inside the card's own lane.
      beforeTaskDrop: ({ taskRecords, targetSwimlane }) => {
        if (!targetSwimlane) return true;
        return taskRecords.every((r) => asTask(r).lane === String(targetSwimlane.id));
      },
      taskDragStart: ({ taskRecords }) => { for (const r of taskRecords) dragOrigin.set(r, String(asTask(r).status)); },
      taskDrop: async ({ source, taskRecords, targetColumn, targetSwimlane }) => {
        const board = source as TaskBoard;
        const lane = targetSwimlane ? String(targetSwimlane.id) : null;
        for (const record of taskRecords) {
          const task = asTask(record);
          const fromStatus = dragOrigin.get(record) ?? String(task.status);
          const rows = columnTasks(board, targetColumn, lane);
          const idx = rows.findIndex((r) => r.id === task.id);
          const prev = idx > 0 ? rows[idx - 1] : null;
          const next = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;
          const prevRank = prev ? prev.rank : null;
          const nextRank = next ? next.rank : null;
          const optimistic = rankBetween(prevRank, nextRank);
          record.set({ rank: optimistic.rank, weight: optimistic.rank });
          for (const r of rows) if (r.id !== task.id && r.weight !== r.rank) r.set({ weight: r.rank });
          try {
            const res = await callbacks.onMove({ taskId: Number(record.id), fromStatus, statusId: String(targetColumn.id), prevRank, nextRank, task: snapshot(record) });
            record.set({ rank: res.rank, weight: res.rank, seeded: false });
            if (res.rebalance && callbacks.onRebalance) {
              const ordered = columnTasks(board, targetColumn, lane).map((r) => ({ id: Number(r.id), rank: r.rank }));
              const fresh = await callbacks.onRebalance(ordered);
              for (const f of fresh) { const r = taskStoreOf(board).getById(f.id) as TaskModel | undefined; r?.set({ rank: f.rank, weight: f.rank }); }
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
