/**
 * Kanban data model: the shape Bryntum TaskBoard records carry, and the mapping from a
 * Pronto task (as /api/tasks returns it) to that shape.
 *
 * TaskBoard needs three things per card: `id`, a column key (`status`, matched against
 * ColumnModel.id) and `weight` (its position inside the column, ascending). Everything
 * else is Pronto data the card template reads.
 *
 * Rank and weight are the same number: the global Kanban rank (see server/rank/rank.js).
 * Keeping weight = rank means TaskBoard's own ordering and the persisted order never
 * disagree.
 */
import type { ProntoTask, StatusInfo } from "../api";

export type GroupBy = "none" | "project" | "assignee" | "brand" | "office";

export type BoardTask = {
  id: number;
  name: string;
  status: string;            // column key: String(statusId)
  weight: number;            // = rank
  rank: number;
  lane: string;              // swimlane key for the active groupBy ("" when none)
  jobId: number | null;
  jobTitle: string;
  jobCode: string;           // short project code shown on the card
  brand: string;
  client: string;
  assignees: ProntoTask["assignees"];
  tags: string[];
  priority: number;
  escalated: boolean;
  starred: boolean;
  endDate: string | null;
  seeded: boolean;
  statusOverridden: boolean;
};

export type BoardColumn = { id: string; text: string; color: string; hidden: boolean; count: number };
export type BoardLane = { id: string; text: string };

export const UNASSIGNED_LANE = "__unassigned";

/** Project code: Pronto shows the job number (extension) on cards; the API gives us the id. */
export function jobCode(t: ProntoTask): string {
  return t.jobId ? `J${t.jobId}` : "";
}

export function laneKey(t: ProntoTask, groupBy: GroupBy): string {
  switch (groupBy) {
    case "project": return t.jobId ? String(t.jobId) : "__noproject";
    case "assignee": return t.assignees[0] ? String(t.assignees[0].id) : UNASSIGNED_LANE;
    case "brand": return t.brand || "__nobrand";
    case "office": return t.client || "__nooffice";
    default: return "";
  }
}

export function laneLabel(t: ProntoTask, groupBy: GroupBy): string {
  switch (groupBy) {
    case "project": return t.jobTitle || "No project";
    case "assignee": return t.assignees[0]?.name || "Unassigned";
    case "brand": return t.brand || "No brand";
    case "office": return t.client || "No office";
    default: return "";
  }
}

export function toBoardTask(t: ProntoTask, groupBy: GroupBy): BoardTask {
  return {
    id: t.id,
    name: t.title,
    status: String(t.statusId),
    weight: t.rank,
    rank: t.rank,
    lane: laneKey(t, groupBy),
    jobId: t.jobId,
    jobTitle: t.jobTitle,
    jobCode: jobCode(t),
    brand: t.brand,
    client: t.client,
    assignees: t.assignees,
    tags: t.tags,
    priority: t.priority,
    escalated: t.escalated,
    starred: t.starred,
    endDate: t.endDate,
    seeded: t.seeded,
    statusOverridden: Boolean(t.statusOverridden),
  };
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

/** Swimlanes for the active grouping, in a stable order (by label, unassigned last). */
export function toLanes(tasks: ProntoTask[], groupBy: GroupBy): BoardLane[] {
  if (groupBy === "none") return [];
  const seen = new Map<string, string>();
  for (const t of tasks) {
    const key = laneKey(t, groupBy);
    if (!seen.has(key)) seen.set(key, laneLabel(t, groupBy));
  }
  const lanes = [...seen.entries()].map(([id, text]) => ({ id, text }));
  lanes.sort((a, b) => {
    const aTail = a.id.startsWith("__"), bTail = b.id.startsWith("__");
    if (aTail !== bTail) return aTail ? 1 : -1;
    return a.text.localeCompare(b.text);
  });
  return lanes;
}
