/**
 * The task workspace shared by Task Explorer and Project Kanban: left nav (presets,
 * saved views, search), control strip, the board (or list) and the filter flyout.
 *
 * Owns the query (preset + advanced filters), the quick search (client-side, over the
 * loaded dataset: BR-11), the board configuration (hidden columns, group-by, zoom; saved
 * per user per board), saved views (BR-08/09), the guardrail notice (BR-10), the
 * persistence callbacks and the live channel (BR-15).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaskBoard } from "@bryntum/taskboard";
import { api, ApiError, type FilterOptions, type Narrowed, type ProntoTask, type SavedView, type StatusInfo, type TaskQuery, type ViewState } from "../api";
import { KanbanBoard } from "../kanban/KanbanBoard";
import { matchesSearch, toBoardTasks, toColumns, toLanes, type BoardTask, type GroupBy } from "../kanban/model";
import { DEFAULT_ZOOM, ZOOM_LEVELS, applyRemoteChange, type BoardCallbacks } from "../kanban/board.config";
import { ControlStrip, GROUP_OPTIONS } from "../chrome/ControlStrip";
import { LeftNav } from "../chrome/PageChrome";
import { AppliedFilters, FilterFlyout, appliedChips, countActive, normaliseFilters, toApiFilter, type Filters } from "../chrome/FilterFlyout";
import { CLIENT_ID, useKanbanChannel } from "../realtime";

export type TaskWorkspaceProps = {
  scope: "explorer" | "project";
  job?: number | null;
  boardKey: string;            // prefs namespace, e.g. "explorer" or "project:1530"
  title: string;
  prontoBase: string;
  groupOptions?: { id: GroupBy; label: string }[];
  defaultGroupBy?: GroupBy;
  viewId?: string | null;      // ?view=<id> from the URL: a saved/shared view to open
};

const REFRESH_MS = 120_000;    // stand-in for Pronto-originated changes (automation, bulk updates)

/**
 * Board height: from the top of the board area down to just above the bottom of the
 * window (so the board's horizontal scrollbar stays visible), recomputed on resize and
 * whenever the content above it (notices, filter chips) changes height.
 */
function useFitToViewport(ref: React.RefObject<HTMLElement | null>, bottomGap = 4, min = 420) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = 0;
    const fit = () => {
      const rect = el.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      // Whatever the page lays out below the board (later siblings, card and page padding) stays visible too.
      let below = 0;
      for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
        for (let sib = a.nextElementSibling as HTMLElement | null; sib; sib = sib.nextElementSibling as HTMLElement | null) {
          const cs = getComputedStyle(sib);
          if (cs.position === "fixed" || cs.position === "absolute" || cs.display === "none") continue;
          below += sib.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
        }
        const parent = a.parentElement;
        if (parent && parent !== document.body) {
          const pcs = getComputedStyle(parent);
          below += (parseFloat(pcs.paddingBottom) || 0) + (parseFloat(pcs.borderBottomWidth) || 0) + (parseFloat(pcs.marginBottom) || 0);
        }
      }
      const h = Math.round(Math.max(min, window.innerHeight - top - below - bottomGap));
      if (Math.abs(h - last) < 2) return;
      last = h;
      el.style.setProperty("--pk-board-height", `${h}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(document.body);
    if (el.parentElement) ro?.observe(el.parentElement);
    return () => { window.removeEventListener("resize", fit); ro?.disconnect(); };
  }, [ref, bottomGap, min]);
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function TaskWorkspace({ scope, job, boardKey, title, prontoBase, groupOptions, defaultGroupBy = "none", viewId }: TaskWorkspaceProps) {
  const [preset, setPreset] = useState("all");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 200);
  const [filters, setFilters] = useState<Filters>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<"list" | "kanban">("kanban");
  const [groupBy, setGroupBy] = useState<GroupBy>(defaultGroupBy);
  const [hidden, setHidden] = useState<Set<number> | null>(null);       // null = use defaults
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [laneRequest, setLaneRequest] = useState<{ collapsed: boolean; seq: number } | null>(null);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [narrow, setNarrow] = useState(true);                            // BR-10 guardrails on
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeView, setActiveView] = useState<string | null>(null);

  const [tasks, setTasks] = useState<ProntoTask[]>([]);
  const tasksRef = useRef<ProntoTask[]>([]);                            // live copy, updated on every move
  const [statuses, setStatuses] = useState<StatusInfo[]>([]);
  const [meta, setMeta] = useState<{ total: number; source: string; truncated: boolean; narrowed: Narrowed | null; office: string | null }>({ total: 0, source: "", truncated: false, narrowed: null, office: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const boardRef = useRef<TaskBoard | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  useFitToViewport(areaRef);

  /* ---- preferences and saved views ------------------------------------------ */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.prefs(boardKey);
        if (!alive) return;
        if (r.prefs?.hiddenStatuses) setHidden(new Set(r.prefs.hiddenStatuses));
        if (r.prefs?.groupBy && GROUP_OPTIONS.some((g) => g.id === r.prefs?.groupBy)) setGroupBy(r.prefs.groupBy as GroupBy);
        if (typeof r.prefs?.zoom === "number" && Number.isInteger(r.prefs.zoom) && r.prefs.zoom >= 0 && r.prefs.zoom < ZOOM_LEVELS.length) setZoom(r.prefs.zoom);
      } catch { /* defaults */ }
      try { const o = await api.filterOptions(); if (alive) setOptions(o); } catch { /* the flyout falls back to the loaded data */ }
      try { const v = await api.views(); if (alive) setViews(v.views.filter((x) => x.board === boardKey)); } catch { /* none */ }
      if (viewId) {
        try { const r = await api.view(viewId); if (alive) applyView(r.view.state, r.view.id); } catch { if (alive) setNotice("That shared view no longer exists."); }
      }
      if (alive) setPrefsLoaded(true);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, viewId]);

  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!prefsLoaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.savePrefs(boardKey, { hiddenStatuses: hidden ? [...hidden] : undefined, groupBy, zoom }).catch(() => { /* best effort */ });
    }, 400);
  }, [hidden, groupBy, zoom, boardKey, prefsLoaded]);

  function currentViewState(): ViewState {
    return { preset, q: search, filters, hiddenStatuses: hidden ? [...hidden] : undefined, groupBy, zoom, narrow };
  }
  function applyView(state: ViewState, id: string | null) {
    if (state.preset) setPreset(state.preset);
    setSearch(state.q || "");
    setFilters(normaliseFilters(state.filters));
    if (state.hiddenStatuses) setHidden(new Set(state.hiddenStatuses));
    if (state.groupBy && GROUP_OPTIONS.some((g) => g.id === state.groupBy)) setGroupBy(state.groupBy as GroupBy);
    if (typeof state.zoom === "number" && Number.isInteger(state.zoom) && state.zoom >= 0 && state.zoom < ZOOM_LEVELS.length) setZoom(state.zoom);
    if (typeof state.narrow === "boolean") setNarrow(state.narrow);
    setActiveView(id);
  }
  async function saveCurrentView() {
    const name = window.prompt("Name this view", "");
    if (!name?.trim()) return;
    try {
      const r = await api.saveView({ name: name.trim(), board: boardKey, state: currentViewState() });
      setViews((v) => [...v, r.view]); setActiveView(r.view.id);
    } catch (e) { setNotice(`Could not save the view: ${(e as Error).message}`); }
  }
  async function openView(id: string) {
    try { const r = await api.view(id); applyView(r.view.state, r.view.id); }
    catch (e) { setNotice(`Could not open the view: ${(e as Error).message}`); }
  }
  async function deleteView(id: string) {
    if (!window.confirm("Delete this saved view?")) return;
    try { await api.deleteView(id); setViews((v) => v.filter((x) => x.id !== id)); if (activeView === id) setActiveView(null); }
    catch (e) { setNotice(`Could not delete the view: ${(e as Error).message}`); }
  }
  function shareView(id: string) {
    const url = `${window.location.origin}${window.location.pathname}?view=${encodeURIComponent(id)}`;
    navigator.clipboard?.writeText(url).then(() => setNotice("Link copied. Anyone you send it to sees the same configuration, and only the tasks they are allowed to see."), () => window.prompt("Copy this link", url));
  }

  /* ---- data ------------------------------------------------------------------ */
  const query = useMemo<TaskQuery>(() => ({ scope, job, preset, narrow, filter: toApiFilter(filters) }), [scope, job, preset, narrow, filters]);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null); }
    try {
      const r = await api.tasks(query);
      tasksRef.current = r.tasks;
      setTasks(r.tasks); setStatuses(r.statuses);
      setMeta({ total: r.total, source: r.source, truncated: r.truncated, narrowed: r.narrowed, office: r.me?.office || null });
    } catch (e) {
      const err = e as ApiError;
      if (!silent) setError(err.authRequired ? "Your Pronto session has expired. Sign in again." : err.message);
    } finally { if (!silent) setLoading(false); }
  }, [query]);
  useEffect(() => { load(); }, [load]);

  // Periodic refresh while visible: the stand-in for changes made inside Pronto (BR-14).
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === "visible" && view === "kanban") load(true); }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load, view]);

  /* ---- live channel (BR-15) --------------------------------------------------- */
  const live = useKanbanChannel(({ event, data }) => {
    const board = boardRef.current;
    const taskId = Number(data.taskId);
    if (event === "task.moved" && taskId) {
      const st = data.status as { id: number; name: string; color: string } | null;
      const t = tasksRef.current.find((x) => x.id === taskId);
      if (t) { t.rank = Number(data.rank); t.seeded = false; if (st) { t.statusId = st.id; t.statusName = st.name; t.statusColor = st.color; } }
      if (board) applyRemoteChange(board, taskId, { rank: Number(data.rank), status: st ? String(st.id) : undefined });
    } else if (event === "task.rebalanced" && board) {
      for (const r of (data.ranks as { id: number; rank: number }[]) || []) { const t = tasksRef.current.find((x) => x.id === r.id); if (t) t.rank = r.rank; applyRemoteChange(board, r.id, { rank: r.rank }); }
    } else if (event === "task.assigned" || event === "board.reset") {
      load(true);
    }
  });

  /* ---- board inputs ---------------------------------------------------------- */
  const visibleTasks = useMemo(() => (q ? tasks.filter((t) => matchesSearch(t, q)) : tasks), [tasks, q]);
  const hiddenSet = useMemo(() => hidden ?? new Set(statuses.filter((s) => s.hiddenByDefault).map((s) => s.id)), [hidden, statuses]);
  const columns = useMemo(() => toColumns(statuses, hiddenSet), [statuses, hiddenSet]);
  const lanes = useMemo(() => toLanes(visibleTasks, groupBy), [visibleTasks, groupBy]);
  const boardTasks = useMemo(() => toBoardTasks(visibleTasks, groupBy), [visibleTasks, groupBy]);
  const groupKey = `${groupBy}|${statuses.map((s) => s.id).join(",")}|${lanes.map((l) => l.id).join(",")}`;
  // Grouped boards open with only the first swimlane expanded; the rest unfold on demand.
  const collapsedLanes = useMemo(() => new Set(lanes.slice(1).map((l) => l.id)), [lanes]);
  const chips = useMemo(() => appliedChips(filters, options, statuses), [filters, options, statuses]);

  const callbacks = useMemo<BoardCallbacks>(() => ({
    onMove: async ({ taskId, fromStatus, statusId, prevRank, nextRank }) => {
      const st = statuses.find((s) => String(s.id) === statusId);
      const changed = st && fromStatus !== statusId ? { id: st.id, name: st.name, color: st.color } : null;
      const res = await api.move({ taskId, status: changed, prevRank, nextRank, origin: CLIENT_ID });
      const t = tasksRef.current.find((x) => x.id === taskId);
      if (t) { t.rank = res.rank; t.seeded = false; if (changed) { t.statusId = changed.id; t.statusName = changed.name; t.statusColor = changed.color; t.statusOverridden = true; } }
      if (res.statusWrite && res.statusWrite.startsWith("failed")) setNotice(`Pronto refused the status change: ${res.statusWrite}`);
      return { rank: res.rank, rebalance: res.rebalance };
    },
    onRebalance: async (ranks) => {
      const out = (await api.rebalance(ranks, CLIENT_ID)).ranks;
      for (const r of out) { const t = tasksRef.current.find((x) => x.id === r.id); if (t) t.rank = r.rank; }
      return out;
    },
    onReassign: async ({ taskId, assignees, toUserName, toUserId }) => {
      const res = await api.assign({ taskId, assignees: assignees.map((a) => ({ id: a.id, name: a.name, avatar: a.avatar })), origin: CLIENT_ID });
      const t = tasksRef.current.find((x) => x.id === taskId);
      if (t) t.assignees = res.assignees.map((a) => ({ ...a, avatarUrl: t.assignees.find((x) => x.id === a.id)?.avatarUrl || null }));
      setNotice(toUserId ? `Task ${taskId} reassigned to ${toUserName}.` : `Task ${taskId} unassigned.`);
    },
    onOpen: (t: BoardTask) => { if (t.jobId) window.open(`${prontoBase}/v2/passport/${t.jobId}/tasklist/${t.taskId}`, "_blank", "noopener"); },
  }), [statuses, prontoBase]);

  const toggleStatus = (id: number) => setHidden((cur) => { const next = new Set(cur ?? hiddenSet); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const resetOrder = async () => {
    if (!window.confirm("Reset the Kanban order for every task back to the seeded order (priority, due date, then newest first)?")) return;
    await api.resetOrder(CLIENT_ID); await load();
  };

  const n = meta.narrowed;
  const narrowedText = n?.applied ? [
    n.office ? `your office (${n.office.name})` : null,
    n.recencyDays ? `activity in the last ${n.recencyDays} days` : null,
    n.cappedTo ? `the ${n.cappedTo} most recently active` : null,
  ].filter(Boolean).join(", ") : null;

  return (
    <div className="pk-workspace">
      <LeftNav preset={preset} onPreset={(p) => { setPreset(p); setActiveView(null); }} search={search} onSearch={setSearch}
        views={views} activeView={activeView} onOpenView={openView} onSaveView={saveCurrentView} onDeleteView={deleteView} onShareView={shareView} />

      <main className="pk-main pk-card">
        <ControlStrip
          title={title} count={visibleTasks.length} total={n?.total ?? meta.total}
          view={view} onView={setView}
          groupBy={groupBy} onGroupBy={setGroupBy} groupOptions={groupOptions}
          onExpandAll={() => setLaneRequest((r) => ({ collapsed: false, seq: (r?.seq || 0) + 1 }))}
          onCollapseAll={() => setLaneRequest((r) => ({ collapsed: true, seq: (r?.seq || 0) + 1 }))}
          statuses={statuses} hidden={hiddenSet} onToggleStatus={toggleStatus} onShowAllStatuses={() => setHidden(new Set())}
          zoom={zoom} onZoom={setZoom}
          filtersOpen={filtersOpen} filterCount={countActive(filters)} onToggleFilters={() => setFiltersOpen((v) => !v)}
          onResetOrder={resetOrder} onReload={() => load()} onSaveView={saveCurrentView} source={meta.source} live={live}
        />

        <AppliedFilters chips={chips} filters={filters} onChange={(f) => { setFilters(f); setActiveView(null); }} />
        {error && <div className="pk-alert pk-alert--error" role="alert">{error}</div>}
        {notice && <div className="pk-alert" role="status">{notice} <button type="button" className="pk-link" onClick={() => setNotice(null)}>Dismiss</button></div>}
        {narrowedText && !error && (
          <div className="pk-alert pk-alert--guard" role="status">
            <strong>Showing {n!.shown.toLocaleString()} of {n!.total.toLocaleString()} tasks.</strong> The view was narrowed to {narrowedText} because the full set is above the {n!.threshold.toLocaleString()}-task limit for a board.
            {" "}<button type="button" className="pk-link" onClick={() => setFiltersOpen(true)}>Refine filters</button>
            {" "}<span className="pk-alert__sep">or</span>{" "}
            <button type="button" className="pk-link" onClick={() => setNarrow(false)}>show everything</button>
          </div>
        )}
        {!narrow && scope === "explorer" && !error && (
          <div className="pk-alert" role="status">Guardrails are off: showing up to {meta.truncated ? "the first " : ""}{tasks.length.toLocaleString()} tasks{meta.truncated ? ` of ${meta.total.toLocaleString()}` : ""}. <button type="button" className="pk-link" onClick={() => setNarrow(true)}>Back to the default view</button></div>
        )}

        <div ref={areaRef} className={`pk-board-area ${loading ? "is-loading" : ""}`}>
          {view === "kanban" ? (
            <KanbanBoard tasks={boardTasks} columns={columns} lanes={lanes} groupBy={groupBy} groupKey={groupKey} zoom={zoom} showProjectOnCards={scope === "explorer" && groupBy !== "project"}
              collapsedLanes={collapsedLanes} laneRequest={laneRequest} callbacks={callbacks} boardRef={boardRef} />
          ) : (
            <TaskList tasks={visibleTasks} onOpen={callbacks.onOpen} />
          )}
          {loading && <div className="pk-loading">Loading tasks…</div>}
        </div>
      </main>

      <FilterFlyout open={filtersOpen} filters={filters} onChange={(f) => { setFilters(f); setActiveView(null); }} onClose={() => setFiltersOpen(false)} tasks={tasks} statuses={statuses} options={options} />
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
            <tr key={t.id} onClick={() => onOpen(toBoardTasks([t], "none")[0])}>
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
