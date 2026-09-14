/**
 * The task workspace shared by Task Explorer and Project Kanban: left nav (presets,
 * saved filters, search), control strip, the board (or list) and the filter flyout.
 *
 * Owns the query (preset + search + advanced filters), the board preferences (hidden
 * columns, group-by, zoom; saved per user per board) and the persistence callbacks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type ProntoTask, type StatusInfo, type TaskQuery } from "../api";
import { KanbanBoard } from "../kanban/KanbanBoard";
import { toBoardTask, toColumns, toLanes, type BoardTask, type GroupBy } from "../kanban/model";
import type { BoardCallbacks } from "../kanban/board.config";
import { ControlStrip, GROUP_OPTIONS, ZOOM_STEPS } from "../chrome/ControlStrip";
import { LeftNav, SAVED_FILTERS } from "../chrome/PageChrome";
import { FilterFlyout, countActive, toApiFilter, type Filters } from "../chrome/FilterFlyout";

export type TaskWorkspaceProps = {
  scope: "explorer" | "project";
  job?: number | null;
  boardKey: string;            // prefs namespace, e.g. "explorer" or "project:1530"
  title: string;
  prontoBase: string;
  groupOptions?: { id: GroupBy; label: string }[];
  defaultGroupBy?: GroupBy;
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function TaskWorkspace({ scope, job, boardKey, title, prontoBase, groupOptions, defaultGroupBy = "none" }: TaskWorkspaceProps) {
  const [preset, setPreset] = useState("all");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 350);
  const [filters, setFilters] = useState<Filters>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<"list" | "kanban">("kanban");
  const [groupBy, setGroupBy] = useState<GroupBy>(defaultGroupBy);
  const [hidden, setHidden] = useState<Set<number> | null>(null);       // null = use defaults
  const [zoom, setZoom] = useState(1);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [tasks, setTasks] = useState<ProntoTask[]>([]);
  const [statuses, setStatuses] = useState<StatusInfo[]>([]);
  const [meta, setMeta] = useState<{ total: number; source: string; truncated: boolean }>({ total: 0, source: "", truncated: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* ---- preferences ---------------------------------------------------------- */
  useEffect(() => {
    let alive = true;
    api.prefs(boardKey).then((r) => {
      if (!alive) return;
      if (r.prefs?.hiddenStatuses) setHidden(new Set(r.prefs.hiddenStatuses));
      if (r.prefs?.groupBy && GROUP_OPTIONS.some((g) => g.id === r.prefs?.groupBy)) setGroupBy(r.prefs.groupBy as GroupBy);
      if (r.prefs?.zoom && ZOOM_STEPS.includes(r.prefs.zoom)) setZoom(r.prefs.zoom);
    }).catch(() => { /* defaults */ }).finally(() => alive && setPrefsLoaded(true));
    return () => { alive = false; };
  }, [boardKey]);

  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!prefsLoaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.savePrefs(boardKey, { hiddenStatuses: hidden ? [...hidden] : undefined, groupBy, zoom }).catch(() => { /* best effort */ });
    }, 400);
  }, [hidden, groupBy, zoom, boardKey, prefsLoaded]);

  /* ---- data ------------------------------------------------------------------ */
  const query = useMemo<TaskQuery>(() => {
    const saved = SAVED_FILTERS.find((s) => s.id === preset);
    return {
      scope, job,
      preset: saved ? "all" : preset,
      q,
      filter: { ...(saved?.query || {}), ...toApiFilter(filters) },
    };
  }, [scope, job, preset, q, filters]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.tasks(query);
      setTasks(r.tasks); setStatuses(r.statuses);
      setMeta({ total: r.total, source: r.source, truncated: r.truncated });
    } catch (e) {
      const err = e as ApiError;
      setError(err.authRequired ? "Your Pronto session has expired. Sign in again." : err.message);
    } finally { setLoading(false); }
  }, [query]);
  useEffect(() => { load(); }, [load]);

  /* ---- board inputs ---------------------------------------------------------- */
  const hiddenSet = useMemo(() => hidden ?? new Set(statuses.filter((s) => s.hiddenByDefault).map((s) => s.id)), [hidden, statuses]);
  const columns = useMemo(() => toColumns(statuses, hiddenSet), [statuses, hiddenSet]);
  const lanes = useMemo(() => toLanes(tasks, groupBy), [tasks, groupBy]);
  const boardTasks = useMemo(() => tasks.map((t) => toBoardTask(t, groupBy)), [tasks, groupBy]);
  const groupKey = `${groupBy}|${statuses.map((s) => s.id).join(",")}|${lanes.map((l) => l.id).join(",")}`;

  const callbacks = useMemo<BoardCallbacks>(() => ({
    onMove: async ({ taskId, fromStatus, statusId, prevRank, nextRank }) => {
      const st = statuses.find((s) => String(s.id) === statusId);
      const changed = st && fromStatus !== statusId ? { id: st.id, name: st.name, color: st.color } : null;
      const res = await api.move({ taskId, status: changed, prevRank, nextRank });
      if (res.statusWrite && res.statusWrite.startsWith("failed")) setNotice(`Pronto refused the status change: ${res.statusWrite}`);
      return { rank: res.rank, rebalance: res.rebalance };
    },
    onRebalance: async (ranks) => (await api.rebalance(ranks)).ranks,
    onOpen: (t: BoardTask) => { if (t.jobId) window.open(`${prontoBase}/v2/passport/${t.jobId}/tasklist/${t.id}`, "_blank", "noopener"); },
    onHideColumn: (id) => setHidden((cur) => { const next = new Set(cur ?? hiddenSet); next.add(Number(id)); return next; }),
  }), [statuses, prontoBase, hiddenSet]);

  const toggleStatus = (id: number) => setHidden((cur) => { const next = new Set(cur ?? hiddenSet); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const resetOrder = async () => {
    if (!window.confirm("Reset the Kanban order for every task back to the seeded order (due date, then newest first)?")) return;
    await api.resetOrder(); await load();
  };

  return (
    <div className="pk-workspace">
      <LeftNav preset={preset} onPreset={setPreset} search={search} onSearch={setSearch} />

      <main className="pk-main pk-card">
        <ControlStrip
          title={title} count={tasks.length} total={meta.total}
          view={view} onView={setView}
          groupBy={groupBy} onGroupBy={setGroupBy} groupOptions={groupOptions}
          statuses={statuses} hidden={hiddenSet} onToggleStatus={toggleStatus} onShowAllStatuses={() => setHidden(new Set())}
          zoom={zoom} onZoom={setZoom}
          filtersOpen={filtersOpen} filterCount={countActive(filters)} onToggleFilters={() => setFiltersOpen((v) => !v)}
          onResetOrder={resetOrder} onReload={load} source={meta.source}
        />

        {error && <div className="pk-alert pk-alert--error" role="alert">{error}</div>}
        {notice && <div className="pk-alert" role="status">{notice} <button type="button" className="pk-link" onClick={() => setNotice(null)}>Dismiss</button></div>}
        {meta.truncated && !error && <div className="pk-alert" role="status">Showing the first {tasks.length.toLocaleString()} of {meta.total.toLocaleString()} tasks. Use the presets or filters to narrow the board.</div>}

        <div className={`pk-board-area ${loading ? "is-loading" : ""}`}>
          {view === "kanban" ? (
            <KanbanBoard tasks={boardTasks} columns={columns} lanes={lanes} groupKey={groupKey} zoom={zoom} showProjectOnCards={scope === "explorer" && groupBy !== "project"} callbacks={callbacks} />
          ) : (
            <TaskList tasks={tasks} onOpen={callbacks.onOpen} />
          )}
          {loading && <div className="pk-loading">Loading tasks…</div>}
        </div>
      </main>

      <FilterFlyout open={filtersOpen} filters={filters} onChange={setFilters} onClose={() => setFiltersOpen(false)} tasks={tasks} statuses={statuses} />
    </div>
  );
}

/** Minimal list view so the list/Kanban toggle is real. Pronto's task list replaces this. */
function TaskList({ tasks, onOpen }: { tasks: ProntoTask[]; onOpen: (t: BoardTask) => void }) {
  const rows = [...tasks].sort((a, b) => a.rank - b.rank);
  return (
    <div className="pk-list">
      <table>
        <thead><tr><th>ID</th><th>Task</th><th>Status</th><th>Project</th><th>Assigned</th><th>Due</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} onClick={() => onOpen(toBoardTask(t, "none"))}>
              <td className="num">{t.id}</td>
              <td><strong>{t.title}</strong></td>
              <td><span className="pk-status-pill pk-status-pill--sm" style={{ ["--pk-status" as string]: t.statusColor }}>{t.statusName}</span></td>
              <td>{t.jobTitle}</td>
              <td>{t.assignees.map((a) => a.name).join(", ")}</td>
              <td>{t.endDate || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
