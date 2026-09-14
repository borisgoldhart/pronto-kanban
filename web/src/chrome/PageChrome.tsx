/**
 * Pronto page chrome for the demo: the Inbox banner (or a project banner), the tab
 * strip and the left navigation with preset and saved filters. Presentation only;
 * the real Pronto pages supply these.
 */
import type { SavedView } from "../api";
import { IconClose, IconLink, IconSearch } from "./icons";

/* ---- Banner ----------------------------------------------------------------- */
export function Banner({ title, code, subtitle }: { title: string; code?: string; subtitle?: string }) {
  return (
    <div className="pk-banner">
      <div className="pk-banner__bg" />
      <div className="pk-banner__titles">
        <div className="pk-banner__title">{title}{code && <span className="pk-banner__code">{code}</span>}</div>
        {subtitle && <div className="pk-banner__sub">{subtitle}</div>}
      </div>
    </div>
  );
}

/* ---- Tabs ------------------------------------------------------------------- */
export function Tabs({ items, active }: { items: string[]; active: string }) {
  return (
    <nav className="pk-tabs" aria-label="Section">
      {items.map((t) => (
        <a key={t} href="#" className={`pk-tab ${t === active ? "is-active" : ""}`} onClick={(e) => e.preventDefault()} aria-current={t === active ? "page" : undefined}>{t}</a>
      ))}
    </nav>
  );
}

export const INBOX_TABS = ["Messages", "Reviews & Proofing", "Project Approvals", "Document Approvals", "Task Explorer", "Task Summary", "Finance Amendments", "Payroll Report", "Timesheet Amendments", "Brand Approvals"];
export const PROJECT_TABS = ["Overview", "Tasks", "Timeline", "Files", "Reviews", "Finance", "Team", "Settings"];

/* ---- Left nav --------------------------------------------------------------- */
export type PresetDef = { id: string; label: string };
export const SYSTEM_PRESETS: PresetDef[] = [
  { id: "all", label: "All Tasks" },
  { id: "mine", label: "Tasks Assigned to Me" },
  { id: "reported", label: "Tasks Reported by Me" },
  { id: "starred", label: "Starred Tasks" },
  { id: "stakeholder", label: "Stakeholder Tasks" },
];
export type LeftNavProps = {
  preset: string; onPreset: (id: string) => void;
  search: string; onSearch: (q: string) => void;
  views: SavedView[]; activeView: string | null;
  onOpenView: (id: string) => void; onSaveView: () => void; onDeleteView: (id: string) => void; onShareView: (id: string) => void;
};

export function LeftNav({ preset, onPreset, search, onSearch, views, activeView, onOpenView, onSaveView, onDeleteView, onShareView }: LeftNavProps) {
  return (
    <aside className="pk-leftnav">
      <label className="pk-search">
        <IconSearch />
        <input type="search" placeholder="Search Tasks..." value={search} onChange={(e) => onSearch(e.target.value)} aria-label="Search tasks" />
      </label>
      <div className="pk-card pk-presets">
        <h3>Preset Filters</h3>
        <ul>
          {SYSTEM_PRESETS.map((p) => (
            <li key={p.id}><button type="button" className={`pk-preset ${preset === p.id && !activeView ? "is-active" : ""}`} onClick={() => onPreset(p.id)}>{p.label}</button></li>
          ))}
        </ul>
        <h3>Saved Views <button type="button" className="pk-link pk-presets__save" onClick={onSaveView} title="Save the current filters, columns and grouping as a view">+ Save current view</button></h3>
        <ul>
          {views.length === 0 && <li className="pk-presets__empty">No saved views yet. Set up the board, then save it here.</li>}
          {views.map((v) => (
            <li key={v.id} className="pk-preset-row">
              <button type="button" className={`pk-preset ${activeView === v.id ? "is-active" : ""}`} onClick={() => onOpenView(v.id)}>{v.name}</button>
              <span className="pk-preset-row__tools">
                <button type="button" className="pk-iconbtn" title="Copy a link to this view" onClick={() => onShareView(v.id)}><IconLink size={13} /></button>
                <button type="button" className="pk-iconbtn" title="Delete this view" onClick={() => onDeleteView(v.id)}><IconClose size={12} /></button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
