/**
 * The board configuration in the URL, so a copied address reproduces the view
 * (through the viewer's own permissions: the API only returns what they may see).
 *
 *   ?preset=mine&q=survey&mode=kanban&group=user&hide=10,443&show=99&narrow=0
 *   &assignees=777,925&pm=1099&offices=1&brands=286&tags=BASep2026&statuses=1,2
 *   &escalated=1&priority=1&reportedBy=777&start=2026-09-01&end=2026-09-30
 *   &parent=48840&type=bug&updatedFrom=2026-08-15&updatedTo=2026-09-14
 *
 * `view=<id>` (a saved view) is left alone: it is what shareView produces and is read
 * by App.tsx. The state is written with history.replaceState, so it never adds history
 * entries. Everything is optional; defaults are omitted to keep addresses short.
 */
import type { Filters } from "./FilterFlyout";
import type { GroupBy } from "../kanban/model";

export type UrlState = {
  preset?: string;
  q?: string;
  mode?: "list" | "kanban";
  groupBy?: GroupBy;
  hidden?: number[];
  shown?: number[];
  narrow?: boolean;
  filters: Filters;
};

const LIST_KEYS: { key: keyof Filters; param: string }[] = [
  { key: "assignees", param: "assignees" }, { key: "projectManagers", param: "pm" }, { key: "offices", param: "offices" },
  { key: "brands", param: "brands" }, { key: "tags", param: "tags" }, { key: "statuses", param: "statuses" },
];
const SCALAR_KEYS: { key: keyof Filters; param: string }[] = [
  { key: "priority", param: "priority" }, { key: "reportedBy", param: "reportedBy" }, { key: "startDate", param: "start" },
  { key: "endDate", param: "end" }, { key: "parentTask", param: "parent" }, { key: "taskType", param: "type" },
  { key: "updatedFrom", param: "updatedFrom" }, { key: "updatedTo", param: "updatedTo" },
];
const GROUPS: GroupBy[] = ["none", "user", "department", "project", "priority"];

export function readUrlState(search = window.location.search): UrlState {
  const p = new URLSearchParams(search);
  const ids = (s: string | null) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
  const filters: Filters = {};
  for (const { key, param } of LIST_KEYS) { const v = ids(p.get(param)); if (v.length) (filters as Record<string, unknown>)[key] = v; }
  for (const { key, param } of SCALAR_KEYS) { const v = p.get(param); if (v) (filters as Record<string, unknown>)[key] = v; }
  if (p.get("escalated") === "1") filters.escalated = true;
  if (p.get("allTags") === "0") filters.allTags = false;
  const group = p.get("group");
  const mode = p.get("mode");
  return {
    preset: p.get("preset") || undefined,
    q: p.get("q") || undefined,
    mode: mode === "list" || mode === "kanban" ? mode : undefined,
    groupBy: group && GROUPS.includes(group as GroupBy) ? (group as GroupBy) : undefined,
    hidden: ids(p.get("hide")).map(Number).filter(Number.isFinite),
    shown: ids(p.get("show")).map(Number).filter(Number.isFinite),
    narrow: p.get("narrow") === "0" ? false : undefined,
    filters,
  };
}

/** True when the address carries any board state (so it should win over saved preferences). */
export function urlHasState(search = window.location.search): boolean {
  const p = new URLSearchParams(search);
  for (const k of p.keys()) if (k !== "view") return true;
  return false;
}

export function writeUrlState(s: UrlState) {
  const p = new URLSearchParams(window.location.search);
  const keep = p.get("view");
  const out = new URLSearchParams();
  if (keep) out.set("view", keep);
  if (s.preset && s.preset !== "all") out.set("preset", s.preset);
  if (s.q) out.set("q", s.q);
  if (s.mode && s.mode !== "kanban") out.set("mode", s.mode);
  if (s.groupBy && s.groupBy !== "none") out.set("group", s.groupBy);
  if (s.hidden?.length) out.set("hide", s.hidden.join(","));
  if (s.shown?.length) out.set("show", s.shown.join(","));
  if (s.narrow === false) out.set("narrow", "0");
  for (const { key, param } of LIST_KEYS) { const v = s.filters[key] as string[] | undefined; if (v?.length) out.set(param, v.join(",")); }
  for (const { key, param } of SCALAR_KEYS) { const v = s.filters[key] as string | undefined; if (v && !(key === "taskType" && v === "all")) out.set(param, v); }
  if (s.filters.escalated) out.set("escalated", "1");
  if (s.filters.allTags === false) out.set("allTags", "0");
  const qs = out.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
}
