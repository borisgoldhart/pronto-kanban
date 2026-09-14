/**
 * Pronto API client (per-user).
 *
 * Every call runs with the signed-in user's credentials (req.pronto.auth from users.js):
 * bearer token plus, when we have one, the Pronto session cookie.
 *
 * Keep this file the ONLY place that knows Pronto URL shapes and payload shapes.
 * Higher layers ask for "tasks matching these filters", never for paths.
 *
 * Endpoints used
 *   GET  /v2/api/bryntum/tickets      the Task Explorer / task list query (JSON, not JSON:API).
 *        Unscoped queries must send is_paginate=1; paging is page[limit] + page[page].
 *        Accepted filter keys (from the API's own validation message):
 *        search, status, assignees, tags, show_all_tags_only, show_escalated_ticket,
 *        reported_by, ticket_type, departments, start_date, end_date, preset,
 *        parent_ticket_id, user_groups, priority_new, brands, jobs, clients,
 *        brand_categories, products, job_statuses, tasks, show_tasks_starred,
 *        show_tasks_stakeholder.
 *   POST /api.v2.php action=tasks&type=update-property   legacy status change (session cookie).
 *   GET  /getUserProfileImage.php?id=<avatar token>      avatars (public).
 */
import { config } from "./config.js";

const JSONAPI = "application/vnd.api+json";

function headersFor(auth) {
  const h = { accept: `application/json, ${JSONAPI}` };
  if (auth?.token) h.authorization = `Bearer ${auth.token}`;
  if (auth?.cookie) h.cookie = auth.cookie;
  return h;
}

function baseOf(auth) {
  return (auth?.baseUrl || config.prontoBaseUrl).replace(/\/+$/, "");
}

/** Low-level fetch. Returns { ok, status, data } or { ok:false, status, error, authRequired }. */
export async function prontoFetch(auth, path, { query, method = "GET", body, form } = {}) {
  const url = new URL(baseOf(auth) + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(`${k}[]`, String(item));
    else url.searchParams.set(k, String(v));
  }
  const init = { method, headers: headersFor(auth) };
  if (form) {
    init.headers["content-type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    init.headers["x-requested-with"] = "XMLHttpRequest";
    init.body = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(url, init); }
  catch (e) { return { ok: false, status: 502, error: `Pronto unreachable: ${e.message}` }; }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (res.status === 401 || res.status === 419) return { ok: false, status: 401, error: "Pronto session expired. Sign in again.", authRequired: true };
  if (!res.ok) {
    const msg = data?.errors?.[0]?.detail || data?.message || data?.error || `Pronto returned HTTP ${res.status}`;
    return { ok: false, status: res.status, error: msg, data };
  }
  if (data && data.success === false) return { ok: false, status: 400, error: data.message || data.errorMessages || "Pronto rejected the request", data };
  return { ok: true, status: res.status, data };
}

/* ---- Task shape ----------------------------------------------------------- */

/**
 * Normalised task, the ONLY shape the rest of the app (and the front end) sees.
 * Pronto's field names stay in this file.
 */
export function normaliseTicket(t) {
  const st = t.ticket_status || {};
  const job = t.job || {};
  return {
    id: Number(t.id),
    title: String(t.title || "").replace(/ /g, " "),
    statusId: Number(st.statusid ?? t.status ?? 0),
    statusName: st.name || "",
    statusColor: st.hexcolor || "#999999",
    jobId: Number(job.jobid ?? t.jobid ?? 0) || null,
    jobTitle: job.jobtitle || "",
    brand: job.brand?.title || "",
    client: job.client?.company || "",
    assignees: (t.assignee_users || []).map((u) => ({ id: Number(u.userid), name: u.name, avatar: u.avatarUrl || null })),
    tags: (t.tags_for_ticket || []).map((g) => String(g.name || "").trim()).filter(Boolean),
    startDate: t.startdateticket ? String(t.startdateticket).slice(0, 10) : null,
    endDate: t.enddateticket ? String(t.enddateticket).slice(0, 10) : null,
    priority: Number(t.priority_new ?? 0),          // 0 none, 1 P1 .. 3 P3 (matches the tile chips)
    escalated: Boolean(t.is_escalated),
    starred: Boolean(t.is_starred),
    parentId: t.parentId != null ? Number(t.parentId) : null,
    activity: t.activity || null,
    sparseIndex: t.sparseIndex != null ? Number(t.sparseIndex) : null,
    progress: Number(t.progress ?? 0),
  };
}

/** Fixture rows are the compact arrays captured from Beta (see server/fixtures). */
export function fromFixtureRow(r) {
  return normaliseTicket({
    id: r[0], title: r[1],
    ticket_status: { statusid: r[2], name: r[3], hexcolor: r[4] },
    job: { jobid: r[5], jobtitle: r[6], brand: { title: r[7] }, client: { company: r[8] } },
    assignee_users: (r[9] || []).map((u) => ({ userid: u[0], name: u[1], avatarUrl: u[2] })),
    tags_for_ticket: (r[10] || []).map((name) => ({ name })),
    startdateticket: r[11], enddateticket: r[12], priority_new: r[13], is_escalated: !!r[14], is_starred: !!r[15],
    parentId: r[16], activity: r[17], sparseIndex: r[18], progress: r[19],
  });
}

/* ---- Domain calls ----------------------------------------------------------- */

/** One page of tasks. `filter` uses the API's own keys; array values become key[]=v. */
export async function listTickets(auth, { filter = {}, page = 1, limit = 500 } = {}) {
  const query = { is_paginate: 1, "page[limit]": limit, "page[page]": page };
  for (const [key, v] of Object.entries(filter)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    query[`filter[${key}]`] = v;
  }
  const r = await prontoFetch(auth, "/v2/api/bryntum/tickets", { query });
  if (!r.ok) return r;
  const rows = Array.isArray(r.data?.data) ? r.data.data.map(normaliseTicket) : [];
  const meta = r.data?.meta || {};
  return { ok: true, rows, total: Number(meta.total_count ?? rows.length), page: Number(meta.current_page ?? page), lastPage: Number(meta.last_page ?? 1) };
}

/** All matching tasks up to `max`, fetched in pages of `limit`. */
export async function fetchTickets(auth, { filter = {}, max = 3000, limit = 500 } = {}) {
  const out = [];
  let page = 1, total = 0, lastPage = 1;
  do {
    const r = await listTickets(auth, { filter, page, limit });
    if (!r.ok) return r;
    out.push(...r.rows);
    total = r.total; lastPage = r.lastPage;
    page += 1;
  } while (page <= lastPage && out.length < max && out.length < total);
  return { ok: true, rows: out, total, truncated: out.length < total };
}

/** Legacy status change, the same call the current Kanban makes. Needs the session cookie. */
export async function updateTicketStatus(auth, taskId, status) {
  return prontoFetch(auth, "/api.v2.php", {
    method: "POST",
    form: {
      action: "tasks", type: "update-property", task: String(taskId), property: "status.id", value: String(status.id),
      "newStatus[id]": String(status.id), "newStatus[title]": status.name, "newStatus[hex_colour]": status.color, "newStatus[translatedStatusTitle]": status.name,
    },
  });
}

/** Absolute avatar URL for an avatar token. */
export function avatarUrl(auth, token) {
  return token ? `${baseOf(auth)}/getUserProfileImage.php?id=${token}` : null;
}
