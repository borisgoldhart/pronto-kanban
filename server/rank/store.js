/**
 * Kanban override store (prototype).
 *
 * Holds the two things the Kanban writes that Pronto's task API does not (yet) own:
 *   - rank:   the task's global order value (see rank.js)
 *   - status: an optional status override, used when KANBAN_WRITE_STATUS is off so a demo
 *             can drag cards between columns without mutating tasks on Beta
 * plus per-user board preferences (hidden columns, group-by, zoom).
 *
 * Backends: Redis hash `overrides` (field = task id) when KV is configured (Vercel),
 * otherwise an in-memory Map persisted to .cache/kanban-overrides.json (local dev).
 *
 * End state in Pronto: rank is a column on the task table and status writes go through
 * the existing task status update; this module disappears.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { kvEnabled, hgetJSON, hsetJSON, hgetallJSON, hdel, jget, jset, del } from "../kv.js";

const HASH = "overrides";
const FILE = path.join(config.cacheDir, "kanban-overrides.json");

const mem = new Map();
if (!kvEnabled) {
  try {
    if (fs.existsSync(FILE)) for (const [id, v] of Object.entries(JSON.parse(fs.readFileSync(FILE, "utf8")))) mem.set(String(id), v);
  } catch { /* start empty */ }
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(config.cacheDir, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(mem)));
    } catch { /* best effort */ }
  }, 150);
}

/** Map of task id -> { rank?, status?, updatedAt } for every overridden task. */
export async function allOverrides() {
  if (kvEnabled) {
    const rows = await hgetallJSON(HASH);
    return new Map(rows.filter((r) => r && r.id != null).map((r) => [String(r.id), r]));
  }
  return new Map(mem);
}

export async function getOverride(taskId) {
  const id = String(taskId);
  if (kvEnabled) return (await hgetJSON(HASH, id)) || null;
  return mem.get(id) || null;
}

/** Merge a patch into a task's override. */
export async function setOverride(taskId, patch) {
  const id = String(taskId);
  const current = (await getOverride(id)) || { id };
  const next = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
  if (kvEnabled) await hsetJSON(HASH, id, next);
  else { mem.set(id, next); persist(); }
  return next;
}

export async function clearOverride(taskId) {
  const id = String(taskId);
  if (kvEnabled) await hdel(HASH, id);
  else { mem.delete(id); persist(); }
}

export async function clearAllOverrides() {
  if (kvEnabled) {
    const rows = await hgetallJSON(HASH);
    for (const r of rows) if (r?.id != null) await hdel(HASH, String(r.id));
  } else { mem.clear(); persist(); }
}

/* ---- per-user board preferences -------------------------------------------- */

const prefsMem = new Map();
const prefsKey = (userKey, board) => `prefs:${userKey}:${board}`;

export async function getPrefs(userKey, board) {
  if (kvEnabled) return (await jget(prefsKey(userKey, board))) || null;
  return prefsMem.get(prefsKey(userKey, board)) || null;
}

export async function setPrefs(userKey, board, prefs) {
  if (kvEnabled) await jset(prefsKey(userKey, board), prefs);
  else prefsMem.set(prefsKey(userKey, board), prefs);
  return prefs;
}

export async function clearPrefs(userKey, board) {
  if (kvEnabled) await del(prefsKey(userKey, board));
  else prefsMem.delete(prefsKey(userKey, board));
}
