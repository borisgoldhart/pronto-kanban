/**
 * Kanban data model: the shape Bryntum TaskBoard records carry, and the mapping from a
 * Pronto task (as /api/tasks returns it) to that shape.
 *
 * TaskBoard needs three things per card: `id`, a column key (`status`, matched against
 * ColumnModel.id) and `weight` (its position inside the column, ascending). Everything
 * else is Pronto data the card template reads.
 *
 * Rank and weight are the same number: the global Kanban rank (see server/rank/rank.js).
 *
 * Swim lanes (BRD BR-06/07, C-02): none, User, Department, Project. A task with several
 * assignees appears once per applicable User or Department lane; each appearance is a
 * separate card record (`id` = "<taskId>:<lane>") pointing at the same `taskId`, and a
 * change to the task is applied to every card that carries its taskId.
 */
import type { ProntoTask, StatusInfo } from "../api";

export type GroupBy = "none" | "user" | "department" | "project";

export type BoardTask = {
  id: string;                // card id: taskId, or "taskId:lane" when a task appears in several lanes
  taskId: number;
  name: string;
  status: string;            // column key: String(statusId)
  weight: number;            // = rank
  rank: number;
  lane: string;              // swimlane key for the active groupBy ("" when none)
  jobId: number | null;
  jobTitle: string;
  jobCode: string;
  projectManager: { id: number; name: string } | null;
  brand: string;
  client: string;
  assignees: ProntoTask["assignees"];
  departments: ProntoTask["departments"];
  tags: string[];
  priority: number;
  escalated: boolean;
  starred: boolean;
  startDate: string | null;
  endDate: string | null;
  isParent: boolean;
  parentTaskId: number | null;   // not "parentId": Bryntum's Model reserves that for tree stores
  parentTitle: string | null;
  activity: string | null;
  seeded: boolean;
  statusOverridden: boolean;
};

export type BoardColumn = { id: string; text: string; color: string; hidden: boolean; count: number };
export type BoardLane = { id: string; text: string };

export const UNASSIGNED_LANE = "__unassigned";
export const NO_DEPARTMENT_LANE = "__nodepartment";
export const NO_PROJECT_LANE = "__noproject";

/** Project code: the job extension Pronto shows (e.g. "2298", "AGRESSO"); the id when the job has none. */
export function jobCode(t: ProntoTask): string {
  return t.jobExtension || (t.jobId ? `J${t.jobId}` : "");
}

/** Lane keys a task belongs to under a grouping (several for User / Department). */
export function laneKeys(t: ProntoTask, groupBy: GroupBy): { id: string; text: string }[] {
  switch (groupBy) {
    case "project":
      return [{ id: t.jobId ? String(t.jobId) : NO_PROJECT_LANE, text: t.jobTitle || "No project" }];
    case "user":
      return t.assignees.length ? t.assignees.map((a) => ({ id: String(a.id), text: a.name })) : [{ id: UNASSIGNED_LANE, text: "Unassigned" }];
    case "department": {
      const deps = t.departments || [];
      return deps.length ? deps.map((d) => ({ id: String(d.id), text: d.name })) : [{ id: NO_DEPARTMENT_LANE, text: "No department" }];
    }
    default:
      return [{ id: "", text: "" }];
  }
}

function base(t: ProntoTask): Omit<BoardTask, "id" | "lane"> {
  return {
    taskId: t.id,
    name: t.title,
    status: String(t.statusId),
    weight: t.rank,
    rank: t.rank,
    jobId: t.jobId,
    jobTitle: t.jobTitle,
    jobCode: jobCode(t),
    projectManager: t.projectManager || null,
    brand: t.brand,
    client: t.client,
    assignees: t.assignees,
    departments: t.departments || [],
    tags: t.tags,
    priority: t.priority,
    escalated: t.escalated,
    starred: t.starred,
    startDate: t.startDate,
    endDate: t.endDate,
    isParent: Boolean(t.isParent),
    parentTaskId: t.parentId,
    parentTitle: t.parentTitle || null,
    activity: t.activity,
    seeded: t.seeded,
    statusOverridden: Boolean(t.statusOverridden),
  };
}

/** One card per lane the task belongs to (one card when there are no lanes). */
export function toBoardTasks(tasks: ProntoTask[], groupBy: GroupBy): BoardTask[] {
  const out: BoardTask[] = [];
  for (const t of tasks) {
    const lanes = laneKeys(t, groupBy);
    const b = base(t);
    if (lanes.length === 1 && groupBy === "none") out.push({ ...b, id: String(t.id), lane: "" });
    else for (const l of lanes) out.push({ ...b, id: `${t.id}:${l.id}`, lane: l.id });
  }
  return out;
}

/** Columns from the status catalogue, honouring the user's hidden set (or the defaults). */
export function toColumns(statuses: StatusInfo[], hidden: Set<number> | null): BoardColumn[] {
  return statuses.map((s) => ({
    id: String(s.id),
    text: s.name,
    color: s.color,
    hidden: hidden ? hidden.has(s.id) : s.hiddenByDefault,
    count: s.count,
  }));
}

/** Swimlanes for the active grouping, in a stable order (by label, the "none" lanes last). */
export function toLanes(tasks: ProntoTask[], groupBy: GroupBy): BoardLane[] {
  if (groupBy === "none") return [];
  const seen = new Map<string, string>();
  for (const t of tasks) for (const l of laneKeys(t, groupBy)) if (!seen.has(l.id)) seen.set(l.id, l.text);
  const lanes = [...seen.entries()].map(([id, text]) => ({ id, text }));
  lanes.sort((a, b) => {
    const aTail = a.id.startsWith("__"), bTail = b.id.startsWith("__");
    if (aTail !== bTail) return aTail ? 1 : -1;
    return a.text.localeCompare(b.text);
  });
  return lanes;
}

/** Quick search over the loaded dataset (BR-11): title, id, project, assignee, tag. */
export function matchesSearch(t: ProntoTask, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return t.title.toLowerCase().includes(s) || String(t.id).includes(s) || t.jobTitle.toLowerCase().includes(s)
    || t.assignees.some((a) => a.name.toLowerCase().includes(s)) || t.tags.some((g) => g.toLowerCase().includes(s));
}
