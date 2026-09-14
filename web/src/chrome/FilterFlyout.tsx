/**
 * "FILTERS: TASKS" flyout, replicating the Task Explorer advanced filters panel so the
 * demo feels familiar. Fields the prototype honours are wired to the tasks query (the
 * API's own filter keys); Project Manager is resolved server-side through the job.
 *
 * Multi-select fields (Assigned Users, Project Manager, Office, Brand, Task Tags, Task
 * Status) render the chosen values as grey chips; the same chips appear under the
 * control strip (AppliedFilters) so the user can see and remove what is applied without
 * opening the flyout.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { FilterOption, FilterOptions, ProntoTask, StatusInfo } from "../api";
import { IconArrowRight, IconCalendar, IconChevronDown, IconChevronUp, IconClose, IconFlame } from "./icons";

export type Filters = {
  assignees?: string[];
  projectManagers?: string[];
  offices?: string[];
  brands?: string[];
  tags?: string[];
  allTags?: boolean;
  statuses?: string[];
  escalated?: boolean;
  priority?: string;
  reportedBy?: string;
  startDate?: string;
  endDate?: string;
  updatedFrom?: string;      // last activity on or after (YYYY-MM-DD)
  updatedTo?: string;        // last activity on or before
  parentTask?: string;
  taskType?: string;
};

const MULTI: (keyof Filters)[] = ["assignees", "projectManagers", "offices", "brands", "tags", "statuses"];

function isSet(k: string, v: unknown): boolean {
  if (k === "allTags") return false;
  if (k === "taskType") return Boolean(v) && v !== "all";
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== "" && v !== false;
}

/** Number of filters in use (the badge on the filter button). */
export function countActive(f: Filters): number {
  return Object.entries(f).filter(([k, v]) => isSet(k, v)).length;
}

/** Translate the flyout state into the API's filter[...] keys. */
export function toApiFilter(f: Filters): Record<string, string | number | (string | number)[]> {
  const out: Record<string, string | number | (string | number)[]> = {};
  if (f.assignees?.length) out.assignees = f.assignees;
  if (f.projectManagers?.length) out.pm = f.projectManagers;
  if (f.offices?.length) out.clients = f.offices;
  if (f.brands?.length) out.brands = f.brands;
  if (f.tags?.length) out.tags = f.tags;
  if (f.allTags && f.tags?.length) out.show_all_tags_only = 1;
  if (f.statuses?.length) out.status = f.statuses;
  if (f.escalated) out.show_escalated_ticket = 1;
  if (f.priority) out.priority_new = [f.priority];
  if (f.reportedBy) out.reported_by = [f.reportedBy];
  if (f.startDate) out.start_date = f.startDate;
  if (f.endDate) out.end_date = f.endDate;
  if (f.updatedFrom) out.updated_from = f.updatedFrom;
  if (f.updatedTo) out.updated_to = f.updatedTo;
  if (f.parentTask) out.parent_ticket_id = f.parentTask;
  if (f.taskType && f.taskType !== "all") out.ticket_type = [f.taskType];
  return out;
}

/** Saved views from before the multi-select change carry single values; lift them. */
export function normaliseFilters(raw: Record<string, unknown> | undefined): Filters {
  if (!raw) return {};
  const f: Record<string, unknown> = { ...raw };
  const lift = (from: string, to: keyof Filters) => { if (typeof f[from] === "string" && f[from]) { f[to] = [f[from]]; } delete f[from]; };
  lift("assignee", "assignees"); lift("tag", "tags"); lift("status", "statuses"); lift("office", "offices");
  delete f.project;
  for (const k of MULTI) if (f[k] !== undefined && !Array.isArray(f[k])) f[k] = f[k] ? [String(f[k])] : [];
  return f as Filters;
}

type Option = { value: string; label: string };
const toOptions = (list: FilterOption[] | undefined): Option[] => (list || []).map((o) => ({ value: String(o.id), label: o.name }));

/** One applied filter, as a chip: label (for the row under the strip) and how to remove it. */
export type AppliedChip = { key: string; label: string; remove: (f: Filters) => Filters };

export function appliedChips(f: Filters, options: FilterOptions | null, statuses: StatusInfo[]): AppliedChip[] {
  const out: AppliedChip[] = [];
  const name = (list: FilterOption[] | undefined, id: string) => list?.find((o) => String(o.id) === id)?.name || id;
  const multi = (key: keyof Filters, list: FilterOption[] | undefined, prefix?: string) => {
    for (const id of (f[key] as string[] | undefined) || []) {
      out.push({ key: `${key}:${id}`, label: `${prefix ? `${prefix}: ` : ""}${name(list, id)}`, remove: (cur) => ({ ...cur, [key]: ((cur[key] as string[]) || []).filter((x) => x !== id) }) });
    }
  };
  multi("assignees", options?.assignees);
  multi("projectManagers", options?.projectManagers, "PM");
  multi("offices", options?.offices);
  multi("brands", options?.brands);
  multi("tags", options?.tags, "Tag");
  multi("statuses", statuses.map((s) => ({ id: s.id, name: s.name })), "Status");
  if (f.escalated) out.push({ key: "escalated", label: "Escalated", remove: (cur) => ({ ...cur, escalated: false }) });
  if (f.priority) out.push({ key: "priority", label: `P${f.priority}`, remove: (cur) => ({ ...cur, priority: undefined }) });
  if (f.reportedBy) out.push({ key: "reportedBy", label: `Reported by ${name(options?.assignees, f.reportedBy)}`, remove: (cur) => ({ ...cur, reportedBy: undefined }) });
  if (f.startDate) out.push({ key: "startDate", label: `From ${f.startDate}`, remove: (cur) => ({ ...cur, startDate: undefined }) });
  if (f.endDate) out.push({ key: "endDate", label: `To ${f.endDate}`, remove: (cur) => ({ ...cur, endDate: undefined }) });
  if (f.updatedFrom) out.push({ key: "updatedFrom", label: `Updated since ${f.updatedFrom}`, remove: (cur) => ({ ...cur, updatedFrom: undefined }) });
  if (f.updatedTo) out.push({ key: "updatedTo", label: `Updated until ${f.updatedTo}`, remove: (cur) => ({ ...cur, updatedTo: undefined }) });
  if (f.parentTask) out.push({ key: "parentTask", label: `Parent #${f.parentTask}`, remove: (cur) => ({ ...cur, parentTask: undefined }) });
  if (f.taskType && f.taskType !== "all") out.push({ key: "taskType", label: `Type: ${f.taskType}`, remove: (cur) => ({ ...cur, taskType: undefined }) });
  return out;
}

/** The grey applied-filter chips, rendered inline in the control strip. */
export function AppliedFilters({ chips, onChange, filters }: { chips: AppliedChip[]; onChange: (f: Filters) => void; filters: Filters }) {
  if (!chips.length) return null;
  return (
    <div className="pk-applied" role="status" aria-label="Applied filters">
      {chips.map((c) => (
        <span key={c.key} className="pk-fchip">
          <span className="pk-fchip__text">{c.label}</span>
          <button type="button" className="pk-fchip__x" onClick={() => onChange(c.remove(filters))} aria-label={`Remove ${c.label}`}><IconClose size={10} /></button>
        </span>
      ))}
      <button type="button" className="pk-link pk-applied__clear" onClick={() => onChange({})}>Clear all</button>
    </div>
  );
}

/* ---- fields ------------------------------------------------------------------- */

function Select({ label, value, placeholder, options, onChange }: { label: string; value: string | undefined; placeholder: string; options: Option[]; onChange: (v: string) => void }) {
  return (
    <label className="pk-field">
      <span className="pk-field__label">{label}</span>
      <span className={`pk-field__control ${value ? "" : "is-placeholder"}`}>
        <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <IconChevronDown />
      </span>
    </label>
  );
}

/** Multi-select: chosen values as chips inside the control, a searchable list below when open. */
function MultiSelect({ label, values, placeholder, options, onChange }: { label: string; values: string[]; placeholder: string; options: Option[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const chosen = values.map((v) => options.find((o) => o.value === v) || { value: v, label: v });
  const list = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <div className="pk-field pk-field--multi" ref={ref}>
      <span className="pk-field__label">{label}</span>
      <div className={`pk-field__control pk-multi ${values.length ? "" : "is-placeholder"} ${open ? "is-open" : ""}`} onClick={() => setOpen(true)}>
        <div className="pk-multi__chips">
          {chosen.map((o) => (
            <span key={o.value} className="pk-fchip">
              <span className="pk-fchip__text">{o.label}</span>
              <button type="button" className="pk-fchip__x" onClick={(e) => { e.stopPropagation(); toggle(o.value); }} aria-label={`Remove ${o.label}`}><IconClose size={10} /></button>
            </span>
          ))}
          <input className="pk-multi__input" value={q} placeholder={values.length ? "" : placeholder} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
        </div>
        <IconChevronDown />
      </div>
      {open && (
        <div className="pk-multi__list" role="listbox" aria-multiselectable="true">
          {list.length === 0 && <div className="pk-multi__empty">No matches</div>}
          {list.map((o) => {
            const on = values.includes(o.value);
            return (
              <button key={o.value} type="button" role="option" aria-selected={on} className={`pk-multi__opt ${on ? "is-on" : ""}`} onClick={() => toggle(o.value)}>
                <span className={`pk-checkbox ${on ? "is-checked" : ""}`} />{o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Check({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode }) {
  return (
    <label className="pk-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="pk-check__box" aria-hidden="true" />
      <span className="pk-check__label">{icon}{label}</span>
    </label>
  );
}

/* ---- the flyout ------------------------------------------------------------------- */

export type FilterDefaults = { note: string; onShowEverything?: () => void } | null;

export function FilterFlyout({ open, filters, onChange, onClose, tasks, statuses, options, defaults }: { open: boolean; filters: Filters; onChange: (f: Filters) => void; onClose: () => void; tasks: ProntoTask[]; statuses: StatusInfo[]; options: FilterOptions | null; defaults?: FilterDefaults }) {
  const [taskOpen, setTaskOpen] = useState(true);

  const opts = useMemo(() => ({
    users: toOptions(options?.assignees),
    pms: toOptions(options?.projectManagers),
    offices: toOptions(options?.offices),
    brands: toOptions(options?.brands),
    tags: toOptions(options?.tags),
    statuses: (options?.statuses?.length ? options.statuses : statuses).map((s) => ({ value: String(s.id), label: s.name })),
  }), [options, statuses]);

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  if (!open) return null;

  return (
    <aside className="pk-flyout" role="dialog" aria-label="Filters: Tasks">
      <header className="pk-flyout__head">
        <h2>Filters: Tasks</h2>
        <button type="button" className="pk-iconbtn" onClick={onClose} aria-label="Close filters"><IconClose /></button>
      </header>

      {defaults && (
        <div className="pk-flyout__note" role="note">
          {defaults.note}
          {defaults.onShowEverything && <> <button type="button" className="pk-link" onClick={defaults.onShowEverything}>Show everything</button></>}
        </div>
      )}

      <section className={`pk-flyout__section ${taskOpen ? "is-open" : ""}`}>
        <button type="button" className="pk-flyout__section-head" onClick={() => setTaskOpen((v) => !v)} aria-expanded={taskOpen}>
          <span>Task-Specific</span>{taskOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
        {taskOpen && (
          <div className="pk-flyout__body">
            <MultiSelect label="Assigned Users" placeholder="Select Assigned Users..." values={filters.assignees || []} options={opts.users} onChange={(v) => set({ assignees: v })} />
            <MultiSelect label="Project Manager" placeholder="Select Project Managers..." values={filters.projectManagers || []} options={opts.pms} onChange={(v) => set({ projectManagers: v })} />
            <MultiSelect label="Office" placeholder="Select Offices..." values={filters.offices || []} options={opts.offices} onChange={(v) => set({ offices: v })} />
            <MultiSelect label="Brand" placeholder="Select Brands..." values={filters.brands || []} options={opts.brands} onChange={(v) => set({ brands: v })} />
            <MultiSelect label="Task Tags" placeholder="Select Task Tags..." values={filters.tags || []} options={opts.tags} onChange={(v) => set({ tags: v })} />
            <Check label="Show Tasks that contain all Task Tags only" checked={filters.allTags ?? true} onChange={(v) => set({ allTags: v })} />
            <MultiSelect label="Task Status" placeholder="Select Task Status..." values={filters.statuses || []} options={opts.statuses} onChange={(v) => set({ statuses: v })} />
            <Check label="Escalated Tasks only" icon={<span className="pk-check__prefix">Show <IconFlame /></span>} checked={Boolean(filters.escalated)} onChange={(v) => set({ escalated: v })} />
            <Select label="Priority" placeholder="Select Priority..." value={filters.priority} options={[{ value: "1", label: "P1" }, { value: "2", label: "P2" }, { value: "3", label: "P3" }]} onChange={(v) => set({ priority: v })} />
            <Select label="Reported By" placeholder="Select Reported By..." value={filters.reportedBy} options={opts.users} onChange={(v) => set({ reportedBy: v })} />
            <div className="pk-field-row">
              <label className="pk-field">
                <span className="pk-field__label">Start Date</span>
                <span className="pk-field__control pk-field__control--date"><IconCalendar /><input type="date" value={filters.startDate || ""} onChange={(e) => set({ startDate: e.target.value })} /></span>
              </label>
              <span className="pk-field-row__arrow"><IconArrowRight /></span>
              <label className="pk-field">
                <span className="pk-field__label">End Date</span>
                <span className="pk-field__control pk-field__control--date"><IconCalendar /><input type="date" value={filters.endDate || ""} onChange={(e) => set({ endDate: e.target.value })} /></span>
              </label>
            </div>
            <div className="pk-field-row">
              <label className="pk-field">
                <span className="pk-field__label">Updated From</span>
                <span className="pk-field__control pk-field__control--date"><IconCalendar /><input type="date" value={filters.updatedFrom || ""} onChange={(e) => set({ updatedFrom: e.target.value })} /></span>
              </label>
              <span className="pk-field-row__arrow"><IconArrowRight /></span>
              <label className="pk-field">
                <span className="pk-field__label">Updated To</span>
                <span className="pk-field__control pk-field__control--date"><IconCalendar /><input type="date" value={filters.updatedTo || ""} onChange={(e) => set({ updatedTo: e.target.value })} /></span>
              </label>
            </div>
            <Select label="Parent Task" placeholder="Select Parent Group Task..." value={filters.parentTask} options={tasks.filter((t) => t.isParent || /parent/i.test(t.statusName)).map((t) => ({ value: String(t.id), label: t.title }))} onChange={(v) => set({ parentTask: v })} />
            <label className="pk-field">
              <span className="pk-field__label">Task Type</span>
              <span className="pk-field__control">
                <select value={filters.taskType || "all"} onChange={(e) => set({ taskType: e.target.value })}>
                  <option value="all">All</option><option value="task">Task</option><option value="bug">Bug</option><option value="request">Request</option>
                </select>
                <IconChevronDown />
              </span>
            </label>
          </div>
        )}
      </section>

      <footer className="pk-flyout__foot">
        <button type="button" className="pk-link" onClick={() => onChange({})}>Clear all filters</button>
      </footer>
    </aside>
  );
}
