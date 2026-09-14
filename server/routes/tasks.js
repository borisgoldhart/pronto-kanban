/**
 * GET /api/tasks
 *   ?scope=explorer                         every task the user can see (Task Explorer)
 *   ?scope=project&job=1530                 one project's tasks (Project Kanban)
 *   &preset=all|mine|reported|starred|stakeholder      left-nav system presets
 *   &filter[<key>]=v&filter[<key>][]=v ...  the Task Explorer advanced filters, passed through
 *   &narrow=0                               lift the Task Explorer default guardrails (BR-10)
 *
 * Returns the normalised tasks with the Kanban rank merged in (stored override, else
 * seed), assignee departments, parent/child markers and the status catalogue.
 *
 * Large dataset handling (BRD BR-10, C-04): a Task Explorer query with no explicit
 * office filter is constrained to the signed-in user's office; if the result still
 * exceeds KANBAN_SAFE_THRESHOLD tasks, only tasks with activity in the last
 * KANBAN_RECENCY_DAYS are kept, and if that is still too many the most recently active
 * tasks up to the threshold are shown. The response says what was applied so the UI can
 * tell the user and offer to refine or broaden.
 *
 * Data source: the signed-in user's Pronto (live) or, when there is no session or
 * KANBAN_FIXTURES=1, the fixtures captured from Beta (local dev, screenshots).
 */
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTickets, listTickets, fromFixtureRow, avatarUrl } from "../pronto.js";
import { allOverrides } from "../rank/store.js";
import { effectiveRank } from "../rank/rank.js";
import { statusCatalogue } from "../statuses.js";
import { getUser, getUsers, getJobs } from "../directory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "..", "fixtures");
const router = Router();

const USE_FIXTURES = process.env.KANBAN_FIXTURES === "1";
const MAX_TASKS = Number(process.env.KANBAN_MAX_TASKS) || 1500;
const SAFE_THRESHOLD = Number(process.env.KANBAN_SAFE_THRESHOLD) || (USE_FIXTURES ? 60 : 300);
const RECENCY_DAYS = Number(process.env.KANBAN_RECENCY_DAYS) || 30;

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")).map(fromFixtureRow);
}

/** Read filter[...] params (both filter[key]=v and filter[key][]=v) into the API's shape. */
function parseFilter(query) {
  const filter = {};
  const raw = query.filter;
  if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw)) filter[k] = v;
  if (query.q) filter.search = String(query.q);
  return filter;
}

/** Map a left-nav preset to API filters, using the signed-in identity. */
function presetFilter(preset, identity) {
  const me = identity?.id ? String(identity.id) : null;
  switch (preset) {
    case "mine": return me ? { assignees: [me] } : {};
    case "reported": return me ? { reported_by: [me] } : {};
    case "starred": return { show_tasks_starred: 1 };
    case "stakeholder": return { show_tasks_stakeholder: 1 };
    default: return {};
  }
}

/** Apply presets/filters to fixture rows (the subset the demo needs). */
function filterFixtureRows(rows, { preset, filter, identity }) {
  const me = identity?.id ? Number(identity.id) : null;
  let out = rows;
  if (preset === "mine" && me) out = out.filter((t) => t.assignees.some((a) => a.id === me));
  if (preset === "starred") out = out.filter((t) => t.starred);
  if (filter.search) { const q = String(filter.search).toLowerCase(); out = out.filter((t) => t.title.toLowerCase().includes(q) || String(t.id).includes(q) || t.jobTitle.toLowerCase().includes(q)); }
  if (filter.status && String(filter.status) === "incomplete") out = out.filter((t) => !/^(completed|deleted|cancelled)$/i.test(t.statusName));
  if (Array.isArray(filter.status) && filter.status.some((s) => /^\d+$/.test(String(s)))) { const ids = filter.status.map(Number); out = out.filter((t) => ids.includes(t.statusId)); }
  if (filter.assignees?.length) { const ids = filter.assignees.map(Number); out = out.filter((t) => t.assignees.some((a) => ids.includes(a.id))); }
  if (filter.tags?.length) { const tags = filter.tags.map((s) => String(s).toLowerCase()); out = out.filter((t) => t.tags.some((g) => tags.includes(g.toLowerCase())) || (t.tagIds || []).some((id) => tags.includes(String(id)))); }
  if (filter.show_escalated_ticket) out = out.filter((t) => t.escalated);
  if (filter.priority_new?.length) { const p = filter.priority_new.map(Number); out = out.filter((t) => p.includes(t.priority)); }
  if (filter.jobs?.length) { const j = filter.jobs.map(Number); out = out.filter((t) => j.includes(t.jobId)); }
  if (filter.clients?.length) { const c = filter.clients.map(String); out = out.filter((t) => c.includes(String(t.clientId)) || c.includes(t.client)); }
  if (filter.brands?.length) { const b = filter.brands.map(String); out = out.filter((t) => b.includes(String(t.brandId)) || b.includes(t.brand)); }
  if (filter.reported_by?.length) { /* fixtures carry no reporter; leave as is */ }
  return out;
}

/** Keys that mean the user has narrowed the query themselves (BR-10 guardrails then step aside). */
const USER_FILTER_KEYS = ["search", "assignees", "pm", "updated_from", "updated_to", "tags", "show_escalated_ticket", "reported_by", "ticket_type", "departments", "start_date", "end_date", "parent_ticket_id", "priority_new", "brands", "jobs", "clients", "products", "show_tasks_starred", "show_tasks_stakeholder"];
function userHasFiltered(preset, filter) {
  if (preset && preset !== "all") return true;
  if (Array.isArray(filter.status) && filter.status.some((s) => /^\d+$/.test(String(s)))) return true;
  return USER_FILTER_KEYS.some((k) => { const v = filter[k]; return v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0); });
}

/** Jobs: project code (extension), project manager, brand and office ids. */
async function enrichFromJobs(auth, tasks) {
  const jobs = await getJobs(auth, tasks.map((t) => t.jobId).filter(Boolean));
  for (const t of tasks) {
    const j = t.jobId ? jobs.get(t.jobId) : null;
    t.jobExtension = j?.extension || null;
    t.projectManagerId = j?.projectManagerId ?? null;
    if (j && t.brandId == null) t.brandId = j.brandId;
    if (j && t.clientId == null) t.clientId = j.clientId;
  }
}

/**
 * Titles of the parent tasks referenced by the loaded set. Parents in the set are free;
 * the rest come from the tickets API by id (filter[tasks][]), a page at a time, cached
 * in memory for the process.
 */
const parentTitleCache = new Map();
async function parentTitlesFor(auth, tasks, parentIds) {
  const out = new Map();
  const missing = [];
  const loaded = new Map(tasks.map((t) => [t.id, t.title]));
  for (const id of parentIds) {
    if (loaded.has(id)) out.set(id, loaded.get(id));
    else if (parentTitleCache.has(id)) out.set(id, parentTitleCache.get(id));
    else missing.push(id);
  }
  if (missing.length && auth && !USE_FIXTURES) {
    for (let i = 0; i < missing.length; i += 100) {
      const r = await listTickets(auth, { filter: { tasks: missing.slice(i, i + 100) }, limit: 100 }).catch(() => null);
      for (const row of r?.ok ? r.rows : []) { out.set(row.id, row.title); parentTitleCache.set(row.id, row.title); }
    }
  }
  return out;
}

const activityMs = (t) => (t.activity ? Date.parse(String(t.activity).replace(" ", "T")) : 0);

/** BR-10: recency window, then a hard cap, applied only when the set is too large. */
function applyGuardrails(tasks, total, narrowed) {
  let out = tasks;
  if (out.length > SAFE_THRESHOLD) {
    const cutoff = Date.now() - RECENCY_DAYS * 86_400_000;
    const recent = out.filter((t) => activityMs(t) >= cutoff);
    narrowed.recencyDays = RECENCY_DAYS;
    narrowed.afterRecency = recent.length;
    out = recent;
  }
  if (out.length > SAFE_THRESHOLD) {
    out = [...out].sort((a, b) => activityMs(b) - activityMs(a)).slice(0, SAFE_THRESHOLD);
    narrowed.cappedTo = SAFE_THRESHOLD;
  }
  narrowed.threshold = SAFE_THRESHOLD;
  narrowed.total = total;
  narrowed.shown = out.length;
  narrowed.applied = Boolean(narrowed.office || narrowed.recencyDays || narrowed.cappedTo);
  return out;
}

/**
 * GET /api/tasks/options: pick-lists for the filter flyout (assignees, project managers,
 * offices, brands, tags, statuses) derived from the tasks the user can see. Pronto has
 * dedicated lookup endpoints for these; the prototype derives them from a broad query so
 * the lists always match the data on the board.
 */
router.get("/options", async (req, res) => {
  const identity = req.pronto?.identity || null;
  const auth = req.pronto?.auth || null;
  let rows;
  if (auth && !USE_FIXTURES) {
    const r = await fetchTickets(auth, { filter: { status: ["incomplete"] }, max: MAX_TASKS });
    if (!r.ok) return res.status(r.status || 502).json({ ok: false, error: r.error, authRequired: Boolean(r.authRequired) });
    rows = r.rows;
  } else {
    rows = [...loadFixture("explorer-sample.json"), ...loadFixture("project-1530.json")];
  }
  await enrichFromJobs(auth, rows);
  const uniq = (pairs) => [...new Map(pairs.filter(([id]) => id != null && id !== "").map(([id, name]) => [String(id), { id, name }])).values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const pmIds = [...new Set(rows.map((t) => t.projectManagerId).filter(Boolean))];
  const pms = await getUsers(auth, pmIds);
  res.json({
    ok: true,
    me: identity ? { id: identity.id, name: identity.name } : null,
    assignees: uniq(rows.flatMap((t) => t.assignees.map((a) => [a.id, a.name]))),
    projectManagers: uniq(pmIds.map((id) => [id, pms.get(id)?.name || `User ${id}`])),
    offices: uniq(rows.map((t) => [t.clientId, t.client])),
    brands: uniq(rows.map((t) => [t.brandId, t.brand])),
    // Tags filter by id on the API (filter[tags][] takes tag ids); fixtures carry names only.
    tags: uniq(rows.flatMap((t) => t.tags.map((g, i) => [(t.tagIds && t.tagIds[i] != null) ? t.tagIds[i] : g, g]))),
    statuses: statusCatalogue(rows).map((s) => ({ id: s.id, name: s.name, color: s.color })),
  });
});

router.get("/", async (req, res) => {
  const scope = req.query.scope === "project" ? "project" : "explorer";
  const job = req.query.job ? Number(req.query.job) : null;
  const preset = String(req.query.preset || "all");
  const narrow = String(req.query.narrow ?? "auto") !== "0";
  const filter = parseFilter(req.query);
  const identity = req.pronto?.identity || null;
  const auth = req.pronto?.auth || null;

  if (scope === "project" && !job) return res.status(400).json({ ok: false, error: "scope=project needs job=<id>" });

  // Who is asking: office for the default Task Explorer constraint (BR-10 / AC-10.1).
  const me = identity?.id ? await getUser(auth, identity.id) : null;
  const narrowed = { office: null, recencyDays: null, cappedTo: null };
  // Project Manager is not a tickets-API filter: it is applied after the fetch, via the job lookup.
  const pmFilter = Array.isArray(filter.pm) ? filter.pm.map(Number) : (filter.pm ? [Number(filter.pm)] : []);
  delete filter.pm;
  // "Updated within" (last activity) is applied after the fetch too: the API has no activity-date key.
  const updatedFrom = filter.updated_from ? Date.parse(`${String(filter.updated_from).slice(0, 10)}T00:00:00`) : null;
  const updatedTo = filter.updated_to ? Date.parse(`${String(filter.updated_to).slice(0, 10)}T23:59:59`) : null;
  delete filter.updated_from; delete filter.updated_to;
  // The API's assignees filter also matches tasks assigned to a user group the person belongs
  // to (e.g. "Customer Support Team"), so a board filtered to one person shows other people's
  // cards. The explicit Assigned Users filter is applied strictly after the fetch: direct
  // assignment only. (The "Tasks Assigned to Me" preset keeps Pronto's group semantics.)
  const strictAssignees = Array.isArray(filter.assignees) ? filter.assignees.map(Number).filter(Boolean) : (filter.assignees ? [Number(filter.assignees)] : []);
  const guard = scope === "explorer" && narrow && !userHasFiltered(preset, filter);
  const explorerDefault = guard && me?.clientId;

  let tasks, source, total, truncated = false;
  if (auth && !USE_FIXTURES) {
    const apiFilter = { ...presetFilter(preset, identity), ...filter };
    // Pronto validates priority_new as a single value, not a list.
    if (Array.isArray(apiFilter.priority_new)) apiFilter.priority_new = apiFilter.priority_new[0];
    if (scope === "project") apiFilter.jobs = [job];
    if (!apiFilter.status) apiFilter.status = ["incomplete"];      // the Task Explorer default
    if (explorerDefault) { apiFilter.clients = [me.clientId]; narrowed.office = { id: me.clientId, name: me.client }; }
    const r = await fetchTickets(auth, { filter: apiFilter, max: MAX_TASKS });
    if (!r.ok) return res.status(r.status || 502).json({ ok: false, error: r.error, authRequired: Boolean(r.authRequired) });
    tasks = r.rows; total = r.total; truncated = r.truncated; source = "pronto";
  } else {
    const rows = scope === "project" ? loadFixture("project-1530.json") : [...loadFixture("explorer-sample.json"), ...loadFixture("project-1530.json")];
    const f = { status: scope === "project" ? undefined : "incomplete", ...filter };
    if (explorerDefault) { f.clients = [String(me.clientId)]; narrowed.office = { id: me.clientId, name: me.client }; }
    await enrichFromJobs(auth, rows);             // brand / office ids come from the job for fixture rows
    tasks = filterFixtureRows(rows, { preset, filter: f, identity });
    total = tasks.length; source = "fixtures";
  }

  await enrichFromJobs(auth, tasks);
  if (pmFilter.length) { tasks = tasks.filter((t) => pmFilter.includes(t.projectManagerId)); total = tasks.length; truncated = false; }
  if (strictAssignees.length) { tasks = tasks.filter((t) => t.assignees.some((a) => strictAssignees.includes(Number(a.id)))); total = tasks.length; truncated = false; }
  if (updatedFrom || updatedTo) {
    tasks = tasks.filter((t) => { const ms = activityMs(t); return (!updatedFrom || ms >= updatedFrom) && (!updatedTo || ms <= updatedTo); });
    total = tasks.length; truncated = false;
  }

  if (guard) tasks = applyGuardrails(tasks, total, narrowed);
  else { narrowed.total = total; narrowed.shown = tasks.length; narrowed.threshold = SAFE_THRESHOLD; narrowed.applied = false; }

  // Overrides (rank, demo status, reassignments), departments, parent markers.
  const overrides = await allOverrides();
  const assigneeIds = new Set();
  for (const t of tasks) {
    const o = overrides.get(String(t.id));
    if (o?.assignees) t.assignees = o.assignees.map((a) => ({ id: Number(a.id), name: a.name, avatar: a.avatar || null }));
    for (const a of t.assignees) assigneeIds.add(a.id);
  }
  for (const t of tasks) if (t.projectManagerId) assigneeIds.add(t.projectManagerId);
  const users = await getUsers(auth, [...assigneeIds]);
  const parentIds = new Set(tasks.map((t) => t.parentId).filter(Boolean));
  const parentTitles = await parentTitlesFor(auth, tasks, parentIds);
  for (const t of tasks) {
    const o = overrides.get(String(t.id));
    t.rank = effectiveRank(t, o?.rank);
    t.seeded = !(typeof o?.rank === "number");
    if (o?.status) { t.statusId = o.status.id; t.statusName = o.status.name; t.statusColor = o.status.color; t.statusOverridden = true; }
    for (const a of t.assignees) {
      const u = users.get(a.id);
      a.avatarUrl = avatarUrl(auth, a.avatar);
      a.departmentId = u?.departmentId ?? null;
      a.department = u?.department ?? null;
      a.office = u?.client ?? null;
    }
    t.departments = [...new Map(t.assignees.filter((a) => a.departmentId).map((a) => [a.departmentId, { id: a.departmentId, name: a.department }])).values()];
    t.isParent = /^parent$/i.test(t.statusName) || parentIds.has(t.id);
    t.parentTitle = t.parentId ? parentTitles.get(t.parentId) || null : null;
    const pm = t.projectManagerId ? users.get(t.projectManagerId) : null;
    t.projectManager = pm ? { id: pm.id, name: pm.name } : (t.projectManagerId ? { id: t.projectManagerId, name: `User ${t.projectManagerId}` } : null);
  }

  res.json({
    ok: true,
    scope, job, preset, source, total, truncated, count: tasks.length,
    narrowed,
    statuses: statusCatalogue(tasks),
    tasks,
    me: identity ? { id: identity.id, name: identity.name, office: me?.client || null, officeId: me?.clientId || null, department: me?.department || null } : null,
  });
});

export default router;
