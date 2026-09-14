/**
 * Card (task tile) templates. Two rows only:
 *   1. title, with the escalation flag at the end
 *   2. meta: task id, project code, priority; assignee avatars on the right
 *
 * Returned as HTML strings for TaskBoard `template` items; every data value goes
 * through encodeHtml. Styling lives in kanban.css (.pk-card-*).
 */
import { StringHelper } from "@bryntum/taskboard";
import type { BoardTask } from "./model";

const enc = (v: unknown) => StringHelper.encodeHtml(String(v ?? ""));

const ICON_TASK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9ZM5 5v1.4h6V5H5Zm0 2.3v1.4h6V7.3H5Zm0 2.3V11h4V9.6H5Z"/></svg>';
const ICON_FLAME = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8.6 1c.3 2.3 2.3 3.3 3 5.4.8 2.4-.4 5.3-2.9 6.2.7-1.3.5-2.5-.3-3.2-.3 1-.9 1.5-1.5 1.9-.6-.6-.9-1.4-.6-2.4C4.7 9.4 4 10.5 4 11.7 4 13.5 5.8 15 8 15c3 0 5-2.2 5-5 0-3.6-3.2-5.3-4.4-9Z"/></svg>';
const ICON_PARENT = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M2 3h5l1.2 1.5H14v8.5H2V3Zm1.5 1.5v7h9V6H7.5L6.3 4.5H3.5Z"/></svg>';
/* Tree: a child task hangs off its parent. */
const ICON_CHILD = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M3 2.5h4.5M3 2.5v9.5h4.5M5.5 8h6"/><rect x="9.5" y="10" width="4" height="3" rx=".8" fill="currentColor"/><rect x="9.5" y="1" width="4" height="3" rx=".8" fill="currentColor"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="m8 1.5 2 4.2 4.6.6-3.4 3.2.9 4.6L8 11.8 3.9 14l.9-4.6L1.4 6.3 6 5.7z"/></svg>';

const PRIORITY: Record<number, { label: string; cls: string }> = {
  1: { label: "P1", cls: "pk-prio--1" },
  2: { label: "P2", cls: "pk-prio--2" },
  3: { label: "P3", cls: "pk-prio--3" },
};

export function initials(name: string): string {
  return name.split(/[\s.@]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() || "").join("");
}

export function avatarHtml(a: { name: string; avatarUrl: string | null }, size = 22): string {
  const alt = enc(a.name);
  if (a.avatarUrl) return `<span class="pk-avatar" title="${alt}" style="width:${size}px;height:${size}px"><img src="${enc(a.avatarUrl)}" alt="${alt}" loading="lazy" onerror="this.parentNode.classList.add('pk-avatar--fallback');this.remove()"><span class="pk-avatar__initials">${enc(initials(a.name))}</span></span>`;
  return `<span class="pk-avatar pk-avatar--fallback" title="${alt}" style="width:${size}px;height:${size}px"><span class="pk-avatar__initials">${enc(initials(a.name))}</span></span>`;
}

export type CardSize = "large" | "medium" | "small";

/**
 * Row 1: the title on one line (the full title is in the hover preview and the
 * native tooltip), the escalation flag at the end. Small cards wrap to two lines
 * instead, since they carry almost nothing else.
 */
export function cardTitle(task: BoardTask, size: CardSize = "large"): string {
  return `<div class="pk-card-title pk-card-title--${size}" title="${enc(task.name)}">
    <span class="pk-card-title__text">${enc(task.name)}</span>
    ${task.escalated ? `<span class="pk-flag pk-flag--escalated" title="Escalated">${ICON_FLAME}</span>` : ""}
  </div>`;
}

/**
 * Row 2, per card size (the zoom levels):
 *   large   id, project code, priority, parent/child, star, avatars (3)
 *   medium  id, priority, parent/child marker, avatars (2)
 *   small   id, priority, one avatar
 */
export function cardMeta(task: BoardTask, opts: { showProject?: boolean; size?: CardSize } = {}): string {
  const size = opts.size || "large";
  const prio = PRIORITY[task.priority];
  const maxAvatars = size === "large" ? 3 : size === "medium" ? 2 : 1;
  const avatars = task.assignees.slice(0, maxAvatars).map((a) => avatarHtml(a)).join("");
  const rest = task.assignees.slice(maxAvatars);
  const extra = rest.length ? `<span class="pk-avatar pk-avatar--more" title="${enc(rest.map((a) => a.name).join(", "))}"><span class="pk-avatar__initials">+${rest.length}</span></span>` : "";
  const parentLabel = task.parentTitle ? `Subtask of: ${task.parentTitle}` : `Subtask of #${task.parentTaskId}`;
  const family = task.isParent
    ? `<span class="pk-chip pk-chip--parent" title="Parent task">${ICON_PARENT}${size === "large" ? "<span>Parent</span>" : ""}</span>`
    : task.parentTaskId ? `<span class="pk-chip pk-chip--child" title="${enc(parentLabel)}">${ICON_CHILD}</span>` : "";
  return `<div class="pk-card-meta pk-card-meta--${size}">
    <span class="pk-chip pk-chip--id" title="Task #${enc(task.taskId)}">${size === "small" ? "" : ICON_TASK}<span>${enc(task.taskId)}</span></span>
    ${size === "large" && opts.showProject !== false && task.jobCode ? `<span class="pk-chip pk-chip--job" title="${enc(task.jobTitle)}">${enc(task.jobCode)}</span>` : ""}
    ${prio ? `<span class="pk-chip pk-prio ${prio.cls}">${prio.label}</span>` : ""}
    ${size === "small" ? "" : family}
    ${size === "large" && task.starred ? `<span class="pk-flag pk-flag--starred" title="Starred">${ICON_STAR}</span>` : ""}
    <span class="pk-card-meta__spacer"></span>
    <span class="pk-avatars">${avatars}${extra}</span>
  </div>`;
}

/** Hover preview (BR-12 / AC-12.2): more of the task without opening Task Detail. */
export function cardPreview(task: BoardTask, statusName: string, statusColor: string): string {
  const prio = PRIORITY[task.priority];
  const row = (label: string, value: string) => value ? `<div class="pk-tip__row"><span class="pk-tip__label">${label}</span><span class="pk-tip__value">${value}</span></div>` : "";
  const people = task.assignees.length ? task.assignees.map((a) => `<span class="pk-tip__person">${avatarHtml(a, 18)}<span>${enc(a.name)}${a.department ? ` <em>${enc(a.department)}</em>` : ""}</span></span>`).join("") : "<span class=\"pk-tip__muted\">Unassigned</span>";
  // TaskBoard's model turns startDate / endDate into Date objects; show the calendar day.
  const day = (d: unknown) => d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10);
  const dates = [task.startDate, task.endDate].filter(Boolean).map((d) => enc(day(d))).join(" to ");
  return `<div class="pk-tip">
    <div class="pk-tip__title">${task.escalated ? `<span class="pk-flag pk-flag--escalated">${ICON_FLAME}</span>` : ""}${enc(task.name)}</div>
    <div class="pk-tip__chips"><span class="pk-chip pk-chip--id">${ICON_TASK}<span>${enc(task.taskId)}</span></span><span class="pk-status-pill pk-status-pill--sm" style="--pk-status:${enc(statusColor)}">${enc(statusName)}</span>${prio ? `<span class="pk-chip pk-prio ${prio.cls}">${prio.label}</span>` : ""}${task.isParent ? `<span class="pk-chip pk-chip--parent">${ICON_PARENT}<span>Parent</span></span>` : ""}</div>
    ${row("Project", task.jobTitle ? `${task.jobCode ? `<strong>${enc(task.jobCode)}</strong> ` : ""}${enc(task.jobTitle)}` : "")}
    ${row("Project Manager", enc(task.projectManager?.name || ""))}
    ${row("Brand", enc(task.brand))}
    ${row("Assigned", people)}
    ${row("Dates", dates)}
    ${task.parentTaskId ? row("Parent task", `${ICON_CHILD} ${task.parentTitle ? enc(task.parentTitle) : ""} <span class="pk-tip__muted">#${enc(task.parentTaskId)}</span>`) : ""}
    ${task.tags.length ? row("Tags", task.tags.map((g) => `<span class="pk-tip__tag">${enc(g)}</span>`).join("")) : ""}
    ${row("Last activity", task.activity ? enc(String(task.activity).slice(0, 16)) : "")}
    <div class="pk-tip__hint">Double-click to open in Pronto</div>
  </div>`;
}

/** Column header title: the status pill in the status colour. */
export function statusPill(name: string, color: string): string {
  return `<span class="pk-status-pill" style="--pk-status:${enc(color)}">${enc(name)}</span>`;
}
