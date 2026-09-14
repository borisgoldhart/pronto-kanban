/**
 * The single control strip above the board (Richard's change to the wireframes: the
 * Kanban controls sit on the same line as the filter and export buttons, the zoom is
 * compact, and the supplementary actions live behind an ellipsis).
 *
 *   ALL TASKS  16 tasks        [list|kanban]  Group by [Project v] [expand|collapse]  [Columns v]  [- Large +]  [filter]  [...]
 *
 * Zoom steps through the card size levels (large / medium / small): each is a different
 * card template, the way Bryntum's zooming demo works, not a CSS scale.
 */
import { useState } from "react";
import type { GroupBy } from "../kanban/model";
import { ZOOM_LEVELS, zoomLevel } from "../kanban/board.config";
import type { StatusInfo } from "../api";
import { IconCheck, IconChevronDown, IconCollapseAll, IconColumns, IconEllipsis, IconExpandAll, IconExport, IconFilter, IconKanban, IconList, IconLive, IconRefresh, IconSave, IconZoomIn, IconZoomOut } from "./icons";
import { Popover } from "./Popover";

/** BRD BR-06: no grouping, User, Department, Project (User Group and Office are out of the MVP). */
export const GROUP_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: "none", label: "None" },
  { id: "user", label: "User" },
  { id: "department", label: "Department" },
  { id: "project", label: "Project" },
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
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  statuses: StatusInfo[];
  hidden: Set<number>;
  onToggleStatus: (id: number) => void;
  onShowAllStatuses: () => void;
  zoom: number;                 // ZOOM_LEVELS index
  onZoom: (z: number) => void;
  filtersOpen: boolean;
  filterCount: number;
  onToggleFilters: () => void;
  onResetOrder: () => void;
  onReload: () => void;
  onSaveView?: () => void;
  source?: string;
  live?: "off" | "connecting" | "live" | "error";
};

export function ControlStrip(p: ControlStripProps) {
  const [menu, setMenu] = useState<"group" | "columns" | "more" | null>(null);
  const toggle = (m: typeof menu) => setMenu((cur) => (cur === m ? null : m));
  const zi = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, p.zoom));
  const groupLabel = (p.groupOptions || GROUP_OPTIONS).find((g) => g.id === p.groupBy)?.label || "None";
  const hiddenCount = p.statuses.filter((s) => p.hidden.has(s.id)).length;

  return (
    <div className="pk-strip">
      <div className="pk-strip__title">
        <h2>{p.title}</h2>
        <span className="pk-strip__count">{p.count.toLocaleString()} {p.count === 1 ? "task" : "tasks"}{p.total > p.count ? ` of ${p.total.toLocaleString()}` : ""}</span>
        {p.live === "live" && <span className="pk-live" title="Live updates connected"><IconLive /> Live</span>}
      </div>

      <div className="pk-strip__controls">
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
          <div className="pk-seg pk-seg--lanes" role="group" aria-label="Swimlanes">
            <button type="button" className="pk-seg__btn" onClick={p.onExpandAll} title="Expand all swimlanes"><IconExpandAll /><span>Expand all</span></button>
            <button type="button" className="pk-seg__btn" onClick={p.onCollapseAll} title="Collapse all swimlanes"><IconCollapseAll /><span>Collapse all</span></button>
          </div>
        )}

        <div className="pk-control">
          <button type="button" className="pk-select" onClick={() => toggle("columns")} aria-haspopup="menu" aria-expanded={menu === "columns"} title="Choose which statuses are shown as columns">
            <IconColumns /><span>Columns</span>{hiddenCount > 0 && <span className="pk-badge">{p.statuses.length - hiddenCount}/{p.statuses.length}</span>}<IconChevronDown />
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

        <div className="pk-zoom" role="group" aria-label="Card size" title="Card size: large, medium or small cards (a different card template per level)">
          <button type="button" className="pk-iconbtn" onClick={() => p.onZoom(zi + 1)} disabled={zi >= ZOOM_LEVELS.length - 1} title="Smaller cards"><IconZoomOut /></button>
          <span className="pk-zoom__value">{zoomLevel(zi).label}</span>
          <button type="button" className="pk-iconbtn" onClick={() => p.onZoom(zi - 1)} disabled={zi <= 0} title="Larger cards"><IconZoomIn /></button>
        </div>

        <button type="button" className={`pk-iconbtn pk-iconbtn--boxed ${p.filtersOpen || p.filterCount ? "is-active" : ""}`} onClick={p.onToggleFilters} title="Filters" aria-pressed={p.filtersOpen}>
          <IconFilter />{p.filterCount > 0 && <span className="pk-badge pk-badge--dot">{p.filterCount}</span>}
        </button>

        <div className="pk-control">
          <button type="button" className="pk-iconbtn pk-iconbtn--boxed" onClick={() => toggle("more")} title="More" aria-haspopup="menu" aria-expanded={menu === "more"}><IconEllipsis /></button>
          <Popover open={menu === "more"} onClose={() => setMenu(null)} width={240}>
            {p.onSaveView && <button type="button" className="pk-menu__item" onClick={() => { p.onSaveView?.(); setMenu(null); }}><IconSave /> Save current view</button>}
            <button type="button" className="pk-menu__item" onClick={() => setMenu(null)}><IconExport /> Export to Excel</button>
            <button type="button" className="pk-menu__item" onClick={() => { p.onReload(); setMenu(null); }}><IconRefresh /> Reload tasks</button>
            <div className="pk-menu__sep" />
            <button type="button" className="pk-menu__item" onClick={() => { p.onResetOrder(); setMenu(null); }}>Reset Kanban order</button>
            {p.source && <div className="pk-menu__note">Data: {p.source === "pronto" ? "live from Pronto" : "captured Beta fixtures"}<br />Live updates: {p.live === "live" ? "connected" : p.live === "connecting" ? "connecting" : p.live === "error" ? "error" : "off (no relay configured)"}</div>}
          </Popover>
        </div>
      </div>
    </div>
  );
}
