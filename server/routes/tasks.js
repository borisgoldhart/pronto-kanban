/**
 * GET /api/tasks
 *   ?scope=explorer                         every task the user can see (Task Explorer)
 *   ?scope=project&job=1530                 one project's tasks (Project Kanban)
 *   &preset=all|mine|reported|starred|stakeholder      left-nav system presets
 *   &filter[<key>]=v&filter[<key>][]=v ...  the Task Explorer advanced filters, passed through
 *   &q=text                                 quick search
 *
 * Returns the normalised tasks with the Kanban rank merged in (stored override, else
 * seed) and the status catalogue for the board's columns.
 *
 * Data source: the signed-in user's Pronto (live) or, when there is no session or
 * KANBAN_FIXTURES=1, the fixtures captured from Beta (local dev, screenshots).
 */
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTickets, fromFixtureRow, avatarUrl } from "../pronto.js";
import { allOverrides } from "../rank/store.js";
import { effectiveRank } from "../rank/rank.js";
import { statusCatalogue } from "../statuses.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "..", "fixtures");
const router = Router();

const USE_FIXTURES = process.env.KANBAN_FIXTURES === "1";
const MAX_TASKS = Number(process.env.KANBAN_MAX_TASKS) || 3000;

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")).map(fromFixtureRow);
}

/** Read filter[...] params (both filter[key]=v and filter[key][]=v) into the API's shape. */
function parseFilter(query) {
  const filter = {};
  const raw = query.filter;
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) filter[k] = v;
  }
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

/** Apply the same presets/filters to fixture rows (subset: enough for the demo). */
function filterFixtureRows(rows, { preset, filter, identity }) {
  const me = identity?.id ? Number(identity.id) : null;
  let out = rows;
  if (preset === "mine" && me) out = out.filter((t) => t.assignees.some((a) => a.id === me));
  if (preset === "starred") out = out.filter((t) => t.starred);
  if (filter.search) { const q = String(filter.search).toLowerCase(); out = out.filter((t) => t.title.toLowerCase().includes(q) || String(t.id).includes(q) || t.jobTitle.toLowerCase().includes(q)); }
  if (filter.status && String(filter.status) === "incomplete") out = out.filter((t) => !/^(completed|deleted|cancelled)$/i.test(t.statusName));
  if (filter.assignees?.length) { const ids = filter.assignees.map(Number); out = out.filter((t) => t.assignees.some((a) => ids.includes(a.id))); }
  if (filter.tags?.length) { const tags = filter.tags.map((s) => String(s).toLowerCase()); out = out.filter((t) => t.tags.some((g) => tags.includes(g.toLowerCase()))); }
  if (filter.show_escalated_ticket) out = out.filter((t) => t.escalated);
  if (filter.priority_new?.length) { const p = filter.priority_new.map(Number); out = out.filter((t) => p.includes(t.priority)); }
  if (filter.jobs?.length) { const j = filter.jobs.map(Number); out = out.filter((t) => j.includes(t.jobId)); }
  return out;
}

router.get("/", async (req, res) => {
  const scope = req.query.scope === "project" ? "project" : "explorer";
  const job = req.query.job ? Number(req.query.job) : null;
  const preset = String(req.query.preset || "all");
  const filter = parseFilter(req.query);
  const identity = req.pronto?.identity || null;
  const auth = req.pronto?.auth || null;

  if (scope === "project" && !job) return res.status(400).json({ ok: false, error: "scope=project needs job=<id>" });

  let tasks, source, total, truncated = false;
  if (auth && !USE_FIXTURES) {
    const apiFilter = { ...presetFilter(preset, identity), ...filter };
    if (scope === "project") apiFilter.jobs = [job];
    if (!apiFilter.status) apiFilter.status = ["incomplete"];      // the Task Explorer default
    const r = await fetchTickets(auth, { filter: apiFilter, max: MAX_TASKS });
    if (!r.ok) return res.status(r.status || 502).json({ ok: false, error: r.error, authRequired: Boolean(r.authRequired) });
    tasks = r.rows; total = r.total; truncated = r.truncated; source = "pronto";
  } else {
    const rows = scope === "project" ? loadFixture(job === 1530 ? "project-1530.json" : "project-1530.json") : [...loadFixture("explorer-sample.json"), ...loadFixture("project-1530.json")];
    tasks = filterFixtureRows(rows, { preset, filter: { status: scope === "project" ? undefined : "incomplete", ...filter }, identity });
    total = tasks.length; source = "fixtures";
  }

  // Merge the Kanban overrides: rank (stored or seeded) and any demo status override.
  const overrides = await allOverrides();
  for (const t of tasks) {
    const o = overrides.get(String(t.id));
    t.rank = effectiveRank(t, o?.rank);
    t.seeded = !(typeof o?.rank === "number");
    if (o?.status) { t.statusId = o.status.id; t.statusName = o.status.name; t.statusColor = o.status.color; t.statusOverridden = true; }
    for (const a of t.assignees) a.avatarUrl = avatarUrl(auth, a.avatar);
  }

  res.json({
    ok: true,
    scope, job, preset, source, total, truncated, count: tasks.length,
    statuses: statusCatalogue(tasks),
    tasks,
    me: identity ? { id: identity.id, name: identity.name } : null,
  });
});

export default router;
