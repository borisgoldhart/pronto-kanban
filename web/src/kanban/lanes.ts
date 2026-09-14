/**
 * The render window: what subset of the loaded tasks is actually in TaskBoard's store
 * (and therefore in the DOM). Two rules keep a big board responsive without hiding data:
 *
 *   1. Lane-lazy loading. On a grouped board only the expanded swimlanes have cards.
 *      Collapsed lanes cost nothing; their cards are added when the lane opens and
 *      removed when it closes.
 *   2. Per-column paging. Each column (per lane) shows its first COLUMN_PAGE cards by
 *      rank, with a "Show more" button at the bottom of the column for the rest. The
 *      full list stays loaded: counts, search and filters see everything; only the
 *      rendering is paged. In production this maps to a query per column
 *      (ORDER BY kanban_rank LIMIT n OFFSET m over the (status, kanban_rank) index).
 *
 * Counts in the swimlane and column headers come from the full task list, not the store.
 */
import type { TaskBoard, TaskModel, TaskStore } from "@bryntum/taskboard";
import type { BoardTask } from "./model";

/** Cards rendered per column (per lane) before "Show more" is needed, and per click. */
export const COLUMN_PAGE = 100;

type Rows = Parameters<TaskStore["add"]>[0];
const sources = new WeakMap<object, LaneSource>();
const NO_LANE = "";
const SEP = "|";   // lane ids and status ids never contain it
const key = (lane: string, status: string) => `${lane}${SEP}${status}`;
const byRank = (a: BoardTask, b: BoardTask) => (a.rank - b.rank) || (a.taskId - b.taskId);

/** The "Show more" control at the end of a paged column is a card record with taskId 0. */
export const MORE_PREFIX = "more:";
export const isMoreCard = (t: { id?: unknown; taskId?: number }) => t.taskId === 0 && String(t.id).startsWith(MORE_PREFIX);
function moreCard(lane: string, status: string, hidden: number, page: number): BoardTask {
  return {
    id: `${MORE_PREFIX}${lane}${SEP}${status}`, taskId: 0, name: `Show ${Math.min(hidden, page)} more`, status, lane,
    weight: Number.MAX_SAFE_INTEGER, rank: Number.MAX_SAFE_INTEGER, jobId: null, jobTitle: "", jobCode: "", projectManager: null, brand: "", client: "",
    assignees: [], departments: [], tags: [], priority: 0, escalated: false, starred: false, startDate: null, endDate: null,
    isParent: false, parentTaskId: null, parentTitle: null, activity: null, seeded: true, statusOverridden: false, moreCount: hidden,
  } as BoardTask & { moreCount: number };
}

export class LaneSource {
  tasks: BoardTask[] = [];
  expanded = new Set<string>();
  /** Cards allowed per (lane, status); absent = COLUMN_PAGE. */
  private limits = new Map<string, number>();
  private buckets = new Map<string, BoardTask[]>();
  page: number;

  constructor(tasks: BoardTask[], expandedLanes: Iterable<string>, page = COLUMN_PAGE) {
    this.page = page;
    this.expanded = new Set(expandedLanes);
    this.index(tasks);
  }

  static of(board: TaskBoard): LaneSource | undefined { return sources.get(board); }
  attach(board: TaskBoard) { sources.set(board, this); }

  private index(tasks: BoardTask[]) {
    this.tasks = tasks;
    this.buckets = new Map();
    for (const t of tasks) {
      const k = key(t.lane ?? NO_LANE, t.status);
      let b = this.buckets.get(k);
      if (!b) { b = []; this.buckets.set(k, b); }
      b.push(t);
    }
    for (const b of this.buckets.values()) b.sort(byRank);
  }

  private limit(lane: string, status: string) { return this.limits.get(key(lane, status)) ?? this.page; }

  /** One column's window plus its "Show more" card when the window is smaller than the column. */
  private windowRows(lane: string, status: string): BoardTask[] {
    const b = this.buckets.get(key(lane, status)) || [];
    const n = this.limit(lane, status);
    const rows = b.slice(0, n);
    if (b.length > n) rows.push(moreCard(lane, status, b.length - n, this.page));
    return rows;
  }

  /** Cards that should be in the store right now. */
  visible(): BoardTask[] {
    const out: BoardTask[] = [];
    for (const k of this.buckets.keys()) {
      const [lane, status] = k.split(SEP);
      if (this.expanded.has(lane)) out.push(...this.windowRows(lane, status));
    }
    return out;
  }
  laneCount(lane: string): number { let n = 0; for (const t of this.tasks) if (t.lane === lane) n++; return n; }
  columnCount(status: string): number { let n = 0; for (const t of this.tasks) if (t.status === status) n++; return n; }
  /** Cards in this column (lane) beyond the render window. */
  hiddenCount(lane: string, status: string): number {
    const b = this.buckets.get(key(lane, status)) || [];
    return Math.max(0, b.length - this.limit(lane, status));
  }

  private store(board: TaskBoard): TaskStore { return board.project.taskStore as TaskStore; }

  /** A new task list (reload, refresh): replace the store contents. Paging resets. */
  setTasks(board: TaskBoard, tasks: BoardTask[]) {
    this.index(tasks);
    this.limits.clear();
    this.store(board).data = this.visible().map((t) => ({ ...t })) as unknown as TaskStore["data"];
  }

  /** Add cards to the store that are not there yet, taking status / rank / assignees from a sibling card of the same task if one is already on the board (it may have been moved since the list was loaded). */
  private addMissing(board: TaskBoard, rows: BoardTask[]) {
    const store = this.store(board);
    const byTask = new Map<number, TaskModel & BoardTask>();
    store.forEach((r) => { const t = r as unknown as TaskModel & BoardTask; if (!byTask.has(t.taskId)) byTask.set(t.taskId, t); });
    const fresh = rows.filter((t) => !store.getById(t.id)).map((t) => {
      const sib = byTask.get(t.taskId);
      return sib ? { ...t, status: sib.status, rank: sib.rank, weight: sib.weight, assignees: sib.assignees, seeded: sib.seeded, statusOverridden: sib.statusOverridden } : { ...t };
    });
    if (fresh.length) store.add(fresh as unknown as Rows);
  }

  /** A card was dragged to another lane (User reassignment, Priority change): keep the buckets and lane counts in step so collapsing and re-opening a lane shows the card where it now is. */
  relane(cardId: string, lane: string) {
    const t = this.tasks.find((x) => x.id === cardId);
    if (!t || t.lane === lane) return;
    t.lane = lane;
    this.index(this.tasks);
  }

  /** The lane opened: add its (windowed) cards. */
  expand(board: TaskBoard, lane: string) {
    if (this.expanded.has(lane)) return;
    this.expanded.add(lane);
    const rows: BoardTask[] = [];
    for (const k of this.buckets.keys()) {
      const [l, status] = k.split(SEP);
      if (l === lane) rows.push(...this.windowRows(lane, status));
    }
    this.addMissing(board, rows);
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

  /** "Show more" on a column: widen its window by one page, add the newly visible cards, move or drop the control card. */
  showMore(board: TaskBoard, lane: string, status: string) {
    const before = this.limit(lane, status);
    this.limits.set(key(lane, status), before + this.page);
    const b = this.buckets.get(key(lane, status)) || [];
    const store = this.store(board);
    const more = store.getById(`${MORE_PREFIX}${lane}${SEP}${status}`) as (TaskModel & { moreCount?: number }) | undefined;
    const hidden = Math.max(0, b.length - (before + this.page));
    if (more && !hidden) store.remove(more);
    else if (more) more.set({ name: `Show ${Math.min(hidden, this.page)} more`, moreCount: hidden });
    this.addMissing(board, b.slice(before, before + this.page));
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
