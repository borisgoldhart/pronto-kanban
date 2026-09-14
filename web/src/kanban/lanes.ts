/**
 * Lane-lazy loading: on a grouped board, only the cards of expanded swimlanes exist in
 * TaskBoard's store (and therefore in the DOM). Collapsed lanes cost nothing to render;
 * their cards are added when the lane opens and removed when it closes. Counts in the
 * swimlane and column headers come from the full task list, not the store.
 *
 * This is what keeps a grouped board with thousands of tasks responsive: the board only
 * ever renders the lanes the user is looking at. Flat boards use TaskBoard's own
 * virtualisation instead.
 */
import type { TaskBoard, TaskModel, TaskStore } from "@bryntum/taskboard";

type Rows = Parameters<TaskStore["add"]>[0];
import type { BoardTask } from "./model";

const sources = new WeakMap<object, LaneSource>();

export class LaneSource {
  tasks: BoardTask[] = [];
  expanded = new Set<string>();

  constructor(tasks: BoardTask[], expandedLanes: Iterable<string>) {
    this.tasks = tasks;
    this.expanded = new Set(expandedLanes);
  }

  static of(board: TaskBoard): LaneSource | undefined { return sources.get(board); }
  attach(board: TaskBoard) { sources.set(board, this); }

  /** Cards that should be in the store right now. */
  visible(): BoardTask[] { return this.tasks.filter((t) => this.expanded.has(t.lane)); }
  laneCount(lane: string): number { let n = 0; for (const t of this.tasks) if (t.lane === lane) n++; return n; }
  columnCount(status: string): number { let n = 0; for (const t of this.tasks) if (t.status === status) n++; return n; }

  private store(board: TaskBoard): TaskStore { return board.project.taskStore as TaskStore; }

  /** A new task list (reload, refresh): replace the store contents for the expanded lanes. */
  setTasks(board: TaskBoard, tasks: BoardTask[]) {
    this.tasks = tasks;
    this.store(board).data = this.visible().map((t) => ({ ...t })) as unknown as TaskStore["data"];
  }

  /** The lane opened: add its cards, taking status / rank / assignees from a sibling card of the same task if one is already on the board (it may have been moved since the list was loaded). */
  expand(board: TaskBoard, lane: string) {
    if (this.expanded.has(lane)) return;
    this.expanded.add(lane);
    const store = this.store(board);
    const byTask = new Map<number, TaskModel & BoardTask>();
    store.forEach((r) => { const t = r as unknown as TaskModel & BoardTask; if (!byTask.has(t.taskId)) byTask.set(t.taskId, t); });
    const rows = this.tasks.filter((t) => t.lane === lane && !store.getById(t.id)).map((t) => {
      const sib = byTask.get(t.taskId);
      return sib ? { ...t, status: sib.status, rank: sib.rank, weight: sib.weight, assignees: sib.assignees, seeded: sib.seeded, statusOverridden: sib.statusOverridden } : { ...t };
    });
    if (rows.length) store.add(rows as unknown as Rows);
  }

  /** The lane closed: drop its cards from the store. */
  collapse(board: TaskBoard, lane: string) {
    if (!this.expanded.has(lane)) return;
    this.expanded.delete(lane);
    const store = this.store(board);
    const gone: TaskModel[] = [];
    store.forEach((r) => { if ((r as unknown as BoardTask).lane === lane) gone.push(r as TaskModel); });
    if (gone.length) store.remove(gone);
  }
}

/** Replace the text of the count node inside a swimlane / column header DomConfig. */
export function setCountInDomConfig(cfg: unknown, className: string, text: string): boolean {
  if (!cfg || typeof cfg !== "object") return false;
  const node = cfg as { className?: unknown; class?: unknown; children?: unknown; text?: string; html?: string };
  const cls = node.className ?? node.class;
  const has = typeof cls === "string" ? cls.includes(className) : (cls && typeof cls === "object" ? Object.keys(cls).includes(className) : false);
  if (has) { node.text = text; delete node.html; return true; }
  const kids = node.children;
  if (Array.isArray(kids)) { for (const k of kids) if (setCountInDomConfig(k, className, text)) return true; }
  else if (kids && typeof kids === "object") { for (const k of Object.values(kids)) if (setCountInDomConfig(k, className, text)) return true; }
  return false;
}
