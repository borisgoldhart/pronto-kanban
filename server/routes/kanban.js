/**
 * Kanban write API.
 *
 *   POST /api/kanban/move        one drag and drop: { taskId, status?, prevRank?, nextRank? }
 *                                -> writes ONE rank (midpoint of the neighbours) and, when the
 *                                   column changed, the status. Returns { rank, rebalance }.
 *   POST /api/kanban/rebalance   { ranks: [{ id, rank }] } in display order -> evenly re-spaced
 *                                ranks for that neighbourhood (called when move said rebalance).
 *   GET  /api/kanban/prefs/:board
 *   PUT  /api/kanban/prefs/:board   { hiddenStatuses, groupBy, zoom }
 *   POST /api/kanban/reset       clear every rank/status override (demo convenience)
 *
 * Status writes reach Pronto only when KANBAN_WRITE_STATUS=1; otherwise the new status is
 * kept as an override so the demo never mutates tasks on Beta.
 */
import { Router } from "express";
import { rankBetween, rebalance as respace } from "../rank/rank.js";
import { setOverride, clearAllOverrides, getPrefs, setPrefs } from "../rank/store.js";
import { updateTicketStatus } from "../pronto.js";

const router = Router();
const WRITE_STATUS = process.env.KANBAN_WRITE_STATUS === "1";

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

router.post("/move", async (req, res) => {
  const { taskId, status, prevRank, nextRank } = req.body || {};
  if (!taskId) return res.status(400).json({ ok: false, error: "taskId required" });
  const { rank, rebalance } = rankBetween(num(prevRank), num(nextRank));
  const patch = { rank };
  let statusWrite = null;
  if (status && status.id != null) {
    const st = { id: Number(status.id), name: String(status.name || ""), color: String(status.color || "") };
    if (WRITE_STATUS && req.pronto?.auth) {
      const r = await updateTicketStatus(req.pronto.auth, taskId, st);
      statusWrite = r.ok ? "pronto" : `failed: ${r.error}`;
      if (!r.ok) patch.status = st;                 // keep the demo consistent even if Pronto refused
    } else {
      patch.status = st;
      statusWrite = "override";
    }
  }
  const saved = await setOverride(taskId, patch);
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
  res.json({ ok: true, ranks: out });
});

router.get("/prefs/:board", async (req, res) => {
  const prefs = await getPrefs(req.pronto?.key || "anon", req.params.board);
  res.json({ ok: true, prefs });
});

router.put("/prefs/:board", async (req, res) => {
  const body = req.body || {};
  const prefs = {
    hiddenStatuses: Array.isArray(body.hiddenStatuses) ? body.hiddenStatuses.map(Number) : undefined,
    groupBy: typeof body.groupBy === "string" ? body.groupBy : undefined,
    zoom: typeof body.zoom === "number" ? body.zoom : undefined,
  };
  const current = (await getPrefs(req.pronto?.key || "anon", req.params.board)) || {};
  const merged = { ...current };
  for (const [k, v] of Object.entries(prefs)) if (v !== undefined) merged[k] = v;
  await setPrefs(req.pronto?.key || "anon", req.params.board, merged);
  res.json({ ok: true, prefs: merged });
});

router.post("/reset", async (_req, res) => {
  await clearAllOverrides();
  res.json({ ok: true });
});

export default router;
