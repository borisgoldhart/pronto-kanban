/**
 * User directory: office (client) and department for users, looked up once and cached.
 *
 * Pronto: GET /v2/api/users/{id}?include=department  -> attributes.clientid/client (office),
 * relationships.department + included department name. The list endpoint's
 * filter[userid] only honours the first id, so users are fetched one by one, a few
 * in parallel, and cached (Redis when configured, else memory) for a day.
 *
 * Jobs: GET /v2/api/jobs/{id} -> jobExtension (the code shown on cards), projectManager (user
 * id), brandId/brandTitle, clientId/clientTitle. Same caching.
 *
 * Fixture mode: server/fixtures/users.json and jobs.json (captured from Beta).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prontoFetch } from "./pronto.js";
import { kvEnabled, jget, jset } from "./kv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USE_FIXTURES = process.env.KANBAN_FIXTURES === "1";
const TTL_SEC = 24 * 3600;
const CONCURRENCY = 6;

const mem = new Map();
const jobMem = new Map();
let fixtureUsers = null;
let fixtureJobs = null;
function jobFixtures() {
  if (!fixtureJobs) {
    fixtureJobs = new Map();
    try {
      for (const r of JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "jobs.json"), "utf8"))) {
        fixtureJobs.set(Number(r[0]), { id: Number(r[0]), extension: r[1], title: r[2], projectManagerId: r[3], brandId: r[4], brand: r[5], clientId: r[6], client: r[7] });
      }
    } catch { /* none */ }
  }
  return fixtureJobs;
}
function fixtures() {
  if (!fixtureUsers) {
    fixtureUsers = new Map();
    try {
      for (const r of JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "users.json"), "utf8"))) {
        fixtureUsers.set(Number(r[0]), { id: Number(r[0]), name: r[1], clientId: r[2], client: r[3], departmentId: r[4], department: r[5] });
      }
    } catch { /* none */ }
  }
  return fixtureUsers;
}

function fromUserResource(res) {
  const d = res?.data;
  if (!d) return null;
  const a = d.attributes || {};
  const depId = d.relationships?.department?.data?.id ?? null;
  const dep = (res.included || []).find((i) => i.type === "departments" && String(i.id) === String(depId));
  return {
    id: Number(d.id), name: a.name || "", clientId: a.clientid ?? null, client: a.client || "",
    departmentId: depId != null ? Number(depId) : null, department: dep?.attributes?.name || null,
  };
}

async function cached(id) {
  if (kvEnabled) return jget(`user:${id}`);
  const hit = mem.get(id);
  return hit && Date.now() - hit.at < TTL_SEC * 1000 ? hit.user : null;
}
async function remember(id, user) {
  if (kvEnabled) await jset(`user:${id}`, user, { ttlSec: TTL_SEC });
  else mem.set(id, { user, at: Date.now() });
}

/** One user (office + department) or null. */
export async function getUser(auth, id) {
  const uid = Number(id);
  if (!uid) return null;
  if (USE_FIXTURES || !auth) return fixtures().get(uid) || null;
  const hit = await cached(uid);
  if (hit) return hit;
  const r = await prontoFetch(auth, `/v2/api/users/${uid}`, { query: { include: "department" } });
  const user = r.ok ? fromUserResource(r.data) : null;
  if (user) await remember(uid, user);
  return user;
}

/** Map id -> user for a set of ids, fetched a few at a time. Unknown ids are absent. */
export async function getUsers(auth, ids) {
  const out = new Map();
  const queue = [...new Set(ids.map(Number).filter(Boolean))];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      const u = await getUser(auth, id);
      if (u) out.set(id, u);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ---- jobs (projects) ----------------------------------------------------------- */

function fromJobResource(res) {
  const a = res?.data?.attributes;
  if (!a) return null;
  return {
    id: Number(a.jobId ?? res.data.id), extension: a.jobExtension || null, title: a.jobTitle || "",
    projectManagerId: a.projectManager != null ? Number(a.projectManager) : null,
    brandId: a.brandId != null ? Number(a.brandId) : null, brand: a.brandTitle || "",
    clientId: a.clientId != null ? Number(a.clientId) : null, client: a.clientTitle || "",
  };
}

export async function getJob(auth, id) {
  const jid = Number(id);
  if (!jid) return null;
  if (USE_FIXTURES || !auth) return jobFixtures().get(jid) || null;
  if (kvEnabled) { const hit = await jget(`job:${jid}`); if (hit) return hit; }
  else { const hit = jobMem.get(jid); if (hit && Date.now() - hit.at < TTL_SEC * 1000) return hit.job; }
  const r = await prontoFetch(auth, `/v2/api/jobs/${jid}`);
  const job = r.ok ? fromJobResource(r.data) : null;
  if (job) { if (kvEnabled) await jset(`job:${jid}`, job, { ttlSec: TTL_SEC }); else jobMem.set(jid, { job, at: Date.now() }); }
  return job;
}

export async function getJobs(auth, ids) {
  const out = new Map();
  const queue = [...new Set(ids.map(Number).filter(Boolean))];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) { const id = queue.shift(); const j = await getJob(auth, id); if (j) out.set(id, j); }
  });
  await Promise.all(workers);
  return out;
}
