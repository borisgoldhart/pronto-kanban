/**
 * "FILTERS: TASKS" flyout, replicating the Task Explorer advanced filters panel so the
 * demo feels familiar. Presentation copy of Pronto's design; the fields that the
 * prototype can honour are wired to the tasks query (the API's own filter keys).
 */
import { useMemo, useState } from "react";
import type { ProntoTask, StatusInfo } from "../api";
import { IconArrowRight, IconCalendar, IconChevronDown, IconChevronUp, IconClose, IconFlame } from "./icons";

export type Filters = {
  assignee?: string;
  tag?: string;
  allTags?: boolean;
  status?: string;
  escalated?: boolean;
  priority?: string;
  reportedBy?: string;
  startDate?: string;
  endDate?: string;
  parentTask?: string;
  taskType?: string;
  project?: string;
  office?: string;
};

export function countActive(f: Filters): number {
  return Object.entries(f).filter(([k, v]) => k !== "allTags" && v !== undefined && v !== "" && v !== false).length;
}

/** Translate the flyout state into the API's filter[...] keys. */
export function toApiFilter(f: Filters): Record<string, string | number | (string | number)[]> {
  const out: Record<string, string | number | (string | number)[]> = {};
  if (f.assignee) out.assignees = [f.assignee];
  if (f.tag) out.tags = [f.tag];
  if (f.allTags) out.show_all_tags_only = 1;
  if (f.status) out.status = [f.status];
  if (f.escalated) out.show_escalated_ticket = 1;
  if (f.priority) out.priority_new = [f.priority];
  if (f.reportedBy) out.reported_by = [f.reportedBy];
  if (f.startDate) out.start_date = f.startDate;
  if (f.endDate) out.end_date = f.endDate;
  if (f.parentTask) out.parent_ticket_id = f.parentTask;
  if (f.taskType && f.taskType !== "all") out.ticket_type = [f.taskType];
  if (f.project) out.jobs = [f.project];
  if (f.office) out.clients = [f.office];
  return out;
}

type Option = { value: string; label: string };

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

function Check({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode }) {
  return (
    <label className="pk-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="pk-check__box" aria-hidden="true" />
      <span className="pk-check__label">{icon}{label}</span>
    </label>
  );
}

export function FilterFlyout({ open, filters, onChange, onClose, tasks, statuses }: { open: boolean; filters: Filters; onChange: (f: Filters) => void; onClose: () => void; tasks: ProntoTask[]; statuses: StatusInfo[] }) {
  const [taskOpen, setTaskOpen] = useState(true);
  const [projectOpen, setProjectOpen] = useState(false);

  // Option lists come from the loaded data so every choice returns results in the demo.
  const opts = useMemo(() => {
    const users = new Map<string, string>(), tags = new Set<string>(), projects = new Map<string, string>(), offices = new Set<string>();
    for (const t of tasks) {
      for (const a of t.assignees) users.set(String(a.id), a.name);
      for (const g of t.tags) tags.add(g);
      if (t.jobId) projects.set(String(t.jobId), t.jobTitle);
      if (t.client) offices.add(t.client);
    }
    const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label);
    return {
      users: [...users].map(([value, label]) => ({ value, label })).sort(byLabel),
      tags: [...tags].map((v) => ({ value: v, label: v })).sort(byLabel),
      projects: [...projects].map(([value, label]) => ({ value, label })).sort(byLabel),
      offices: [...offices].map((v) => ({ value: v, label: v })).sort(byLabel),
      statuses: statuses.map((s) => ({ value: String(s.id), label: s.name })),
    };
  }, [tasks, statuses]);

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  if (!open) return null;

  return (
    <aside className="pk-flyout" role="dialog" aria-label="Filters: Tasks">
      <header className="pk-flyout__head">
        <h2>Filters: Tasks</h2>
        <button type="button" className="pk-iconbtn" onClick={onClose} aria-label="Close filters"><IconClose /></button>
      </header>

      <section className={`pk-flyout__section ${taskOpen ? "is-open" : ""}`}>
        <button type="button" className="pk-flyout__section-head" onClick={() => setTaskOpen((v) => !v)} aria-expanded={taskOpen}>
          <span>Task-Specific</span>{taskOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
        {taskOpen && (
          <div className="pk-flyout__body">
            <Select label="Assigned Users" placeholder="Select Assigned Users..." value={filters.assignee} options={opts.users} onChange={(v) => set({ assignee: v })} />
            <Select label="Task Tags" placeholder="Select Task Tags..." value={filters.tag} options={opts.tags} onChange={(v) => set({ tag: v })} />
            <Check label="Show Tasks that contain all Task Tags only" checked={filters.allTags ?? true} onChange={(v) => set({ allTags: v })} />
            <Select label="Task Status" placeholder="Select Task Status..." value={filters.status} options={opts.statuses} onChange={(v) => set({ status: v })} />
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
            <Select label="Parent Task" placeholder="Select Parent Group Task..." value={filters.parentTask} options={tasks.filter((t) => /parent/i.test(t.statusName)).map((t) => ({ value: String(t.id), label: t.title }))} onChange={(v) => set({ parentTask: v })} />
            <label className="pk-field">
              <span className="pk-field__label">Task Type</span>
              <span className="pk-field__control">
                <select value={filters.taskType || "all"} onChange={(e) => set({ taskType: e.target.value })}>
                  <option value="all">All</option><option value="task">Task</option><option value="bug">Bug</option><option value="request">Request</option>
                </select>
                <IconChevronDown />
              </span>
            </label>
            <Select label="Project" placeholder="Select Project..." value={filters.project} options={opts.projects} onChange={(v) => set({ project: v })} />
          </div>
        )}
      </section>

      <section className={`pk-flyout__section ${projectOpen ? "is-open" : ""}`}>
        <button type="button" className="pk-flyout__section-head" onClick={() => setProjectOpen((v) => !v)} aria-expanded={projectOpen}>
          <span>Project-Specific</span>{projectOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
        {projectOpen && (
          <div className="pk-flyout__body">
            <Select label="Project Office" placeholder="Select Project Office..." value={filters.office} options={opts.offices} onChange={(v) => set({ office: v })} />
          </div>
        )}
      </section>

      <footer className="pk-flyout__foot">
        <button type="button" className="pk-link" onClick={() => onChange({})}>Clear all filters</button>
      </footer>
    </aside>
  );
}
