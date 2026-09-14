/**
 * User directory: office (client) and department for users, looked up once and cached.
 *
 * Pronto: GET /v2/api/users/{id}?include=department  -> attributes.clientid/client (office),
 * relationships.department + included department name. The list endpoint's
 * filter[userid] only honours the first id, so users are fetched one by one, a few
 * in parallel, and cached (Redis when configured, else memory) for a day.
 *
 * Fixture mode: server/fixtures/users.json (captured from Beta for the fixture assignees).
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
let fixtureUsers = null;
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
