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

/** Row 1. */
export function cardTitle(task: BoardTask): string {
  return `<div class="pk-card-title" title="${enc(task.name)}">
    <span class="pk-card-title__text">${enc(task.name)}</span>
    ${task.escalated ? `<span class="pk-flag pk-flag--escalated" title="Escalated">${ICON_FLAME}</span>` : ""}
  </div>`;
}

/** Row 2. */
export function cardMeta(task: BoardTask, opts: { showProject?: boolean } = {}): string {
  const prio = PRIORITY[task.priority];
  const avatars = task.assignees.slice(0, 3).map((a) => avatarHtml(a)).join("");
  const extra = task.assignees.length > 3 ? `<span class="pk-avatar pk-avatar--more" title="${enc(task.assignees.slice(3).map((a) => a.name).join(", "))}"><span class="pk-avatar__initials">+${task.assignees.length - 3}</span></span>` : "";
  return `<div class="pk-card-meta">
    <span class="pk-chip pk-chip--id" title="Task #${enc(task.id)}">${ICON_TASK}<span>${enc(task.id)}</span></span>
    ${opts.showProject !== false && task.jobCode ? `<span class="pk-chip pk-chip--job" title="${enc(task.jobTitle)}">${enc(task.jobCode)}</span>` : ""}
    ${prio ? `<span class="pk-chip pk-prio ${prio.cls}">${prio.label}</span>` : ""}
    ${task.starred ? `<span class="pk-flag pk-flag--starred" title="Starred">${ICON_STAR}</span>` : ""}
    <span class="pk-card-meta__spacer"></span>
    <span class="pk-avatars">${avatars}${extra}</span>
  </div>`;
}

/** Column header title: the status pill in the status colour. */
export function statusPill(name: string, color: string): string {
  return `<span class="pk-status-pill" style="--pk-status:${enc(color)}">${enc(name)}</span>`;
}
