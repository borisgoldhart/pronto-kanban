/**
 * The single control strip above the board (Richard's change to the wireframes: the
 * Kanban controls sit on the same line as the filter and export buttons, the zoom is
 * compact, and the supplementary actions live behind an ellipsis).
 *
 *   ALL TASKS (i) [list|kanban] Group by [Project v] [^v]        [chip x] [chip x] [filter] [Columns v] [...]
 *
 * The count, live state and data source sit behind the (i) icon; the applied filters
 * are chips in the strip itself (right-aligned, before the filter button), so nothing
 * sits between the strip and the column headers.
 */
import { useState, type ReactNode } from "react";
import type { GroupBy } from "../kanban/model";
import type { StatusInfo } from "../api";
import { IconCheck, IconChevronDown, IconCollapseAll, IconColumns, IconEllipsis, IconExpandAll, IconExport, IconFilter, IconInfo, IconKanban, IconList, IconLive, IconRefresh, IconSave } from "./icons";
import { Popover } from "./Popover";

/** BRD BR-06: no grouping, User, Department, Project; Priority added 14 Sep (User Group and Office are out of the MVP). */
export const GROUP_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: "none", label: "None" },
  { id: "user", label: "User" },
  { id: "department", label: "Department" },
  { id: "project", label: "Project" },
  { id: "priority", label: "Priority" },
];

export type ControlStripProps = {
  title: string;
  count: number;
  total: number;
  view: "list" | "kanban";
  onView: (v: "list" | "kanban") => void;
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
  groupOptions?: { id: GroupBy; label: string }[];
  lanesOpen?: boolean;              // grouped boards: are the lanes expanded? (toggle icon)
  onToggleLanes?: () => void;
  statuses: StatusInfo[];
  hidden: Set<number>;
  onToggleStatus: (id: number) => void;
  onShowAllStatuses: () => void;
  filtersOpen: boolean;
  filterCount: number;
  onToggleFilters: () => void;
  onResetOrder: () => void;
  onReload: () => void;
  onSaveView?: () => void;
  source?: string;
  live?: "off" | "connecting" | "live" | "error";
  info?: ReactNode;                 // extra lines for the (i) popover (guardrails, data source)
  chips?: ReactNode;                // applied-filter chips rendered inside the strip
};

export function ControlStrip(p: ControlStripProps) {
  const [menu, setMenu] = useState<"group" | "columns" | "more" | "info" | null>(null);
  const toggle = (m: typeof menu) => setMenu((cur) => (cur === m ? null : m));
  const groupLabel = (p.groupOptions || GROUP_OPTIONS).find((g) => g.id === p.groupBy)?.label || "None";
  const liveText = p.live === "live" ? "connected" : p.live === "connecting" ? "connecting" : p.live === "error" ? "error" : "off (no relay configured)";

  return (
    <div className="pk-strip">
      <div className="pk-strip__title">
        <h2>{p.title}</h2>
        <div className="pk-control">
          <button type="button" className={`pk-infobtn ${p.live === "live" ? "is-live" : ""}`} onClick={() => toggle("info")} onMouseEnter={() => setMenu("info")} aria-haspopup="dialog" aria-expanded={menu === "info"} title="About this board"><IconInfo /></button>
          <Popover open={menu === "info"} onClose={() => setMenu(null)} align="start" width={280}>
            <div className="pk-info" onMouseLeave={() => setMenu((m) => (m === "info" ? null : m))}>
              <div className="pk-info__row"><strong>{p.count.toLocaleString()}</strong> {p.count === 1 ? "task" : "tasks"}{p.total > p.count ? ` of ${p.total.toLocaleString()}` : ""}</div>
              <div className="pk-info__row"><span className={`pk-live ${p.live === "live" ? "" : "is-off"}`}><IconLive /> Live updates</span> {liveText}</div>
              {p.source && <div className="pk-info__row">Data: {p.source === "pronto" ? "live from Pronto" : "captured Beta fixtures"}</div>}
              {p.info}
            </div>
          </Popover>
        </div>
        <div className="pk-seg" role="group" aria-label="View">
          <button type="button" className={`pk-seg__btn ${p.view === "list" ? "is-active" : ""}`} onClick={() => p.onView("list")} title="List"><IconList /></button>
          <button type="button" className={`pk-seg__btn ${p.view === "kanban" ? "is-active" : ""}`} onClick={() => p.onView("kanban")} title="Kanban"><IconKanban /><span>Kanban</span></button>
        </div>

        <div className="pk-control">
          <span className="pk-control__label">Group by</span>
          <button type="button" className="pk-select" onClick={() => toggle("group")} aria-haspopup="menu" aria-expanded={menu === "group"}>
            <span>{groupLabel}</span><IconChevronDown />
          </button>
          <Popover open={menu === "group"} onClose={() => setMenu(null)} width={200}>
            {(p.groupOptions || GROUP_OPTIONS).map((g) => (
              <button key={g.id} type="button" className={`pk-menu__item ${g.id === p.groupBy ? "is-active" : ""}`} onClick={() => { p.onGroupBy(g.id); setMenu(null); }}>
                <span className="pk-menu__check">{g.id === p.groupBy && <IconCheck />}</span>{g.label}
              </button>
            ))}
          </Popover>
        </div>
        {p.groupBy !== "none" && (
          <button type="button" className="pk-iconbtn pk-iconbtn--boxed" onClick={p.onToggleLanes} title={p.lanesOpen ? "Collapse all swimlanes" : "Expand all swimlanes"} aria-pressed={Boolean(p.lanesOpen)}>
            {p.lanesOpen ? <IconCollapseAll /> : <IconExpandAll />}
          </button>
        )}

      </div>

      <div className="pk-strip__controls">
        {p.chips}
        <button type="button" className={`pk-iconbtn pk-iconbtn--boxed ${p.filtersOpen || p.filterCount ? "is-active" : ""}`} onClick={p.onToggleFilters} title="Filters" aria-pressed={p.filtersOpen}>
          <IconFilter />{p.filterCount > 0 && <span className="pk-badge pk-badge--dot">{p.filterCount}</span>}
        </button>

        <div className="pk-control">
          <button type="button" className="pk-select" onClick={() => toggle("columns")} aria-haspopup="menu" aria-expanded={menu === "columns"} title="Choose which statuses are shown as columns">
            <IconColumns /><span>Columns</span><IconChevronDown />
          </button>
          <Popover open={menu === "columns"} onClose={() => setMenu(null)} width={280}>
            <div className="pk-menu__head">Columns <button type="button" className="pk-link" onClick={p.onShowAllStatuses}>Show all</button></div>
            <div className="pk-menu__scroll">
              {p.statuses.map((s) => {
                const on = !p.hidden.has(s.id);
                return (
                  <button key={s.id} type="button" className={`pk-menu__item pk-menu__item--status ${on ? "is-on" : ""}`} onClick={() => p.onToggleStatus(s.id)} role="menuitemcheckbox" aria-checked={on}>
                    <span className={`pk-checkbox ${on ? "is-checked" : ""}`}>{on && <IconCheck />}</span>
                    <span className="pk-status-pill pk-status-pill--sm" style={{ ["--pk-status" as string]: s.color }}>{s.name}</span>
                    <span className="pk-menu__count">{s.count}</span>
                  </button>
                );
              })}
            </div>
          </Popover>
        </div>


        <div className="pk-control">
          <button type="button" className="pk-iconbtn pk-iconbtn--boxed" onClick={() => toggle("more")} title="More" aria-haspopup="menu" aria-expanded={menu === "more"}><IconEllipsis /></button>
          <Popover open={menu === "more"} onClose={() => setMenu(null)} width={240}>
            {p.onSaveView && <button type="button" className="pk-menu__item" onClick={() => { p.onSaveView?.(); setMenu(null); }}><IconSave /> Save current view</button>}
            <button type="button" className="pk-menu__item" onClick={() => setMenu(null)}><IconExport /> Export to Excel</button>
            <button type="button" className="pk-menu__item" onClick={() => { p.onReload(); setMenu(null); }}><IconRefresh /> Reload tasks</button>
            <div className="pk-menu__sep" />
            <button type="button" className="pk-menu__item" onClick={() => { p.onResetOrder(); setMenu(null); }}>Reset Kanban order</button>
          </Popover>
        </div>
      </div>
    </div>
  );
}
