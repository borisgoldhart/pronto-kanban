/**
 * Pronto page chrome for the demo: the Inbox banner (or a project banner), the tab
 * strip and the left navigation with preset and saved filters. Presentation only;
 * the real Pronto pages supply these.
 */
import { IconSearch } from "./icons";

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
/** Demo saved filters (user-created in Pronto). Each maps to a query the API understands. */
export const SAVED_FILTERS: (PresetDef & { query: Record<string, string | number | (string | number)[]> })[] = [
  { id: "saved:toyota", label: "Toyota (Q3 2025)", query: { search: "survey" } },
  { id: "saved:design", label: "All Design Tasks (Active)", query: { search: "design" } },
];

export function LeftNav({ preset, onPreset, search, onSearch }: { preset: string; onPreset: (id: string) => void; search: string; onSearch: (q: string) => void }) {
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
            <li key={p.id}><button type="button" className={`pk-preset ${preset === p.id ? "is-active" : ""}`} onClick={() => onPreset(p.id)}>{p.label}</button></li>
          ))}
        </ul>
        <h3>Saved Filters</h3>
        <ul>
          {SAVED_FILTERS.map((p) => (
            <li key={p.id}><button type="button" className={`pk-preset ${preset === p.id ? "is-active" : ""}`} onClick={() => onPreset(p.id)}>{p.label}</button></li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
