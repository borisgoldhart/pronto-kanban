/**
 * Kanban write API.
 *
 *   POST /api/kanban/move        one drag and drop: { taskId, status?, prevRank?, nextRank?, origin? }
 *                                -> writes ONE rank (midpoint of the neighbours) and, when the
 *                                   column changed, the status. Returns { rank, rebalance }.
 *   POST /api/kanban/rebalance   { ranks: [{ id, rank }] } in display order -> evenly re-spaced
 *                                ranks for that neighbourhood (called when move said rebalance).
 *   POST /api/kanban/assign      { taskId, assignees: [{id,name,avatar}], origin? } -> the task's
 *                                assignee list after a drag between User swim lanes (BR-07).
 *   GET  /api/kanban/prefs/:board
 *   PUT  /api/kanban/prefs/:board   { hiddenStatuses, groupBy, zoom }
 *   GET  /api/kanban/views          the user's saved views (BR-08/09)
 *   POST /api/kanban/views          { name, board, state } -> { id, url }
 *   GET  /api/kanban/views/:id      one view (shareable by URL; data access stays per user)
 *   DELETE /api/kanban/views/:id
 *   POST /api/kanban/reset       clear every rank/status/assignee override (demo convenience)
 *
 * Every write is broadcast on the private Kanban channel (see realtime.js) so other open
 * boards update in place. Status and assignee writes reach Pronto only when
 * KANBAN_WRITE_STATUS=1; otherwise they are kept as overrides so the demo never mutates Beta.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { rankBetween, rebalance as respace } from "../rank/rank.js";
import { setOverride, clearAllOverrides, getPrefs, setPrefs } from "../rank/store.js";
import { updateTicketStatus } from "../pronto.js";
import { publish } from "../realtime.js";
import { kvEnabled, jget, jset, del } from "../kv.js";

const router = Router();
const WRITE_STATUS = process.env.KANBAN_WRITE_STATUS === "1";

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const userKey = (req) => req.pronto?.key || "anon";
const actor = (req) => ({ id: req.pronto?.identity?.id || null, name: req.pronto?.identity?.name || null });

router.post("/move", async (req, res) => {
  const { taskId, status, prevRank, nextRank, origin } = req.body || {};
  if (!taskId) return res.status(400).json({ ok: false, error: "taskId required" });
  const { rank, rebalance } = rankBetween(num(prevRank), num(nextRank));
  const patch = { rank };
  let statusWrite = null;
  let st = null;
  if (status && status.id != null) {
    st = { id: Number(status.id), name: String(status.name || ""), color: String(status.color || "") };
    if (WRITE_STATUS && req.pronto?.auth) {
      const r = await updateTicketStatus(req.pronto.auth, taskId, st);
      statusWrite = r.ok ? "pronto" : `failed: ${r.error}`;
      if (!r.ok) patch.status = st;
    } else {
      patch.status = st;
      statusWrite = "override";
    }
  }
  const saved = await setOverride(taskId, patch);
  publish("task.moved", { taskId: Number(taskId), rank: saved.rank, status: st, by: actor(req) }, { origin });
  res.json({ ok: true, taskId: Number(taskId), rank: saved.rank, rebalance, statusWrite });
});

router.post("/rebalance", async (req, res) => {
  const ranks = Array.isArray(req.body?.ranks) ? req.body.ranks : [];
  if (ranks.length < 2) return res.json({ ok: true, ranks: [] });
  const next = respace(ranks.map((r) => Number(r.rank)));
  const out = [];
  for (let i = 0; i < ranks.length; i++) {
    const saved = await setOverride(ranks[i].id, { rank: next[i] });
    out.push({ id: Number(ranks[i].id), rank: saved.rank });
  }
  publish("task.rebalanced", { ranks: out, by: actor(req) }, { origin: req.body?.origin });
  res.json({ ok: true, ranks: out });
});

router.post("/assign", async (req, res) => {
  const { taskId, assignees, origin } = req.body || {};
  if (!taskId || !Array.isArray(assignees)) return res.status(400).json({ ok: false, error: "taskId and assignees required" });
  const clean = assignees.filter((a) => a && a.id != null).map((a) => ({ id: Number(a.id), name: String(a.name || ""), avatar: a.avatar || null }));
  // Prototype: assignment changes are kept as overrides. Pronto's task assignment API
  // takes this write in the end state (the legacy Kanban does not reassign).
  const saved = await setOverride(taskId, { assignees: clean });
  publish("task.assigned", { taskId: Number(taskId), assignees: saved.assignees, by: actor(req) }, { origin });
  res.json({ ok: true, taskId: Number(taskId), assignees: saved.assignees, write: "override" });
});

/* ---- board preferences ------------------------------------------------------- */

router.get("/prefs/:board", async (req, res) => {
  res.json({ ok: true, prefs: await getPrefs(userKey(req), req.params.board) });
});

router.put("/prefs/:board", async (req, res) => {
  const body = req.body || {};
  const prefs = {
    hiddenStatuses: Array.isArray(body.hiddenStatuses) ? body.hiddenStatuses.map(Number) : undefined,
    groupBy: typeof body.groupBy === "string" ? body.groupBy : undefined,
    zoom: typeof body.zoom === "number" ? body.zoom : undefined,
  };
  const current = (await getPrefs(userKey(req), req.params.board)) || {};
  const merged = { ...current };
  for (const [k, v] of Object.entries(prefs)) if (v !== undefined) merged[k] = v;
  await setPrefs(userKey(req), req.params.board, merged);
  res.json({ ok: true, prefs: merged });
});

/* ---- saved views (BR-08, BR-09) ------------------------------------------------ */
// A view = name + board + state { preset, q, filters, hiddenStatuses, groupBy, zoom }.
// Stored by id (shareable link) plus an index per user. A recipient opening a shared
// view gets the configuration only; the tasks API still applies their own access.

const viewsMem = new Map();
const indexMem = new Map();
const viewKey = (id) => `view:${id}`;
const indexKey = (uk) => `views:${uk}`;

async function readView(id) { return kvEnabled ? jget(viewKey(id)) : viewsMem.get(id) || null; }
async function writeView(view) { if (kvEnabled) await jset(viewKey(view.id), view); else viewsMem.set(view.id, view); }
async function removeView(id) { if (kvEnabled) await del(viewKey(id)); else viewsMem.delete(id); }
async function readIndex(uk) { return (kvEnabled ? await jget(indexKey(uk)) : indexMem.get(uk)) || []; }
async function writeIndex(uk, list) { if (kvEnabled) await jset(indexKey(uk), list); else indexMem.set(uk, list); }

router.get("/views", async (req, res) => {
  const ids = await readIndex(userKey(req));
  const views = (await Promise.all(ids.map(readView))).filter(Boolean);
  res.json({ ok: true, views: views.map(({ id, name, board, createdAt }) => ({ id, name, board, createdAt })) });
});

router.post("/views", async (req, res) => {
  const { name, board, state } = req.body || {};
  if (!name || !board || !state) return res.status(400).json({ ok: false, error: "name, board and state required" });
  const id = crypto.randomBytes(6).toString("base64url");
  const view = { id, name: String(name).slice(0, 80), board: String(board), state, owner: userKey(req), by: actor(req), createdAt: new Date().toISOString() };
  await writeView(view);
  const idx = await readIndex(userKey(req));
  await writeIndex(userKey(req), [...idx, id]);
  res.json({ ok: true, view });
});

router.get("/views/:id", async (req, res) => {
  const view = await readView(req.params.id);
  if (!view) return res.status(404).json({ ok: false, error: "View not found" });
  res.json({ ok: true, view });
});

router.delete("/views/:id", async (req, res) => {
  const view = await readView(req.params.id);
  if (!view) return res.status(404).json({ ok: false, error: "View not found" });
  if (view.owner !== userKey(req)) return res.status(403).json({ ok: false, error: "Only the owner can delete a view" });
  await removeView(view.id);
  await writeIndex(userKey(req), (await readIndex(userKey(req))).filter((x) => x !== view.id));
  res.json({ ok: true });
});

router.post("/reset", async (req, res) => {
  await clearAllOverrides();
  publish("board.reset", { by: actor(req) }, { origin: req.body?.origin });
  res.json({ ok: true });
});

export default router;
