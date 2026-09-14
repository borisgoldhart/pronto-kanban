/** Thin client for this app's own API. The browser never talks to Pronto directly. */

export type Identity = { id: string | null; email: string | null; name: string | null };

export type AuthStatus = {
  baseUrl: string;
  environment: { baseUrl: string; label: string; isDefault: boolean };
  environments: { label: string; baseUrl: string; isDefault: boolean }[];
  allowCustomEnvironment: boolean;
  mode: "session" | "env" | "none";
  authRequired: boolean;
  identity: Identity | null;
  tokenGeneratorUrl: string | null;
  broker: boolean;
};

/** A Pronto task as the API normalises it (server/pronto.js), plus the Kanban rank. */
export type ProntoTask = {
  id: number;
  title: string;
  statusId: number;
  statusName: string;
  statusColor: string;
  jobId: number | null;
  jobTitle: string;
  brand: string;
  client: string;
  assignees: { id: number; name: string; avatar: string | null; avatarUrl: string | null; departmentId?: number | null; department?: string | null; office?: string | null }[];
  departments?: { id: number; name: string }[];
  tags: string[];
  startDate: string | null;
  endDate: string | null;
  priority: number;
  escalated: boolean;
  starred: boolean;
  parentId: number | null;
  parentTitle?: string | null;
  activity: string | null;
  sparseIndex: number | null;
  progress: number;
  rank: number;
  seeded: boolean;
  statusOverridden?: boolean;
  isParent?: boolean;
  clientId?: number | null;
  brandId?: number | null;
  jobExtension?: string | null;          // the project code Pronto shows (from the job)
  projectManager?: { id: number; name: string } | null;
};

/** Pick-lists for the filter flyout (GET /api/tasks/options). */
export type FilterOption = { id: string | number; name: string };
export type FilterOptions = {
  ok: true; me: { id: string; name: string } | null;
  assignees: FilterOption[]; projectManagers: FilterOption[]; offices: FilterOption[]; brands: FilterOption[]; tags: FilterOption[];
  statuses: { id: number; name: string; color: string }[];
};

/** What the Task Explorer guardrails (BRD BR-10) did to this result. */
export type Narrowed = {
  applied: boolean;
  office: { id: number; name: string } | null;
  recencyDays: number | null;
  cappedTo: number | null;
  afterRecency?: number;
  threshold: number;
  total: number;
  shown: number;
};

export type SavedView = { id: string; name: string; board: string; createdAt: string; state?: ViewState; owner?: string };
/** zoom: no longer used (older saved views may still carry it). */
export type ViewState = { preset?: string; q?: string; filters?: Record<string, unknown>; hiddenStatuses?: number[]; shownStatuses?: number[]; groupBy?: string; mode?: "list" | "kanban"; zoom?: number; narrow?: boolean };

export type StatusInfo = { id: number; name: string; color: string; count: number; hiddenByDefault: boolean; isParent?: boolean };

export type TasksResponse = {
  ok: true; scope: "explorer" | "project"; job: number | null; preset: string; source: "pronto" | "fixtures";
  total: number; truncated: boolean; count: number; statuses: StatusInfo[]; tasks: ProntoTask[]; narrowed: Narrowed;
  me: { id: string; name: string; office: string | null; officeId: number | null; department: string | null } | null;
};

/** hiddenStatuses: columns the user hid; shownStatuses: default-hidden columns (Completed, Parent...) the user chose to show. */
export type BoardPrefs = { hiddenStatuses?: number[]; shownStatuses?: number[]; groupBy?: string; zoom?: number };

export type MoveResult = { ok: true; taskId: number; rank: number; rebalance: boolean; statusWrite: string | null };

export class ApiError extends Error {
  status: number; authRequired: boolean; body: unknown;
  constructor(message: string, status: number, authRequired = false, body?: unknown) { super(message); this.status = status; this.authRequired = authRequired; this.body = body; }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && body.ok === false)) throw new ApiError(body?.error || `HTTP ${res.status}`, res.status, Boolean(body?.authRequired), body);
  return body as T;
}

/** Task query as the left nav + filter flyout express it; serialised to the API's filter[...] keys. */
export type TaskQuery = {
  scope: "explorer" | "project";
  job?: number | null;
  preset?: string;
  q?: string;
  narrow?: boolean;
  filter?: Record<string, string | number | (string | number)[] | undefined>;
};

export function taskQueryString(query: TaskQuery): string {
  const p = new URLSearchParams();
  p.set("scope", query.scope);
  if (query.job) p.set("job", String(query.job));
  if (query.preset) p.set("preset", query.preset);
  if (query.q) p.set("q", query.q);
  if (query.narrow === false) p.set("narrow", "0");
  for (const [k, v] of Object.entries(query.filter || {})) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) for (const item of v) p.append(`filter[${k}][]`, String(item));
    else p.set(`filter[${k}]`, String(v));
  }
  return p.toString();
}

export const api = {
  status: () => call<AuthStatus>("/api/auth/status"),
  login: (body: { email?: string; password?: string; token?: string; baseUrl?: string }) => call<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => call<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  brokerStart: (baseUrl?: string) => call<{ ok: true; pid: string; loginUrl: string; pollMs: number }>("/api/auth/broker/start", { method: "POST", body: JSON.stringify({ baseUrl }) }),
  brokerPoll: (pid: string) => call<{ ok: true; pending?: boolean; retryAfter?: number }>("/api/auth/broker/poll", { method: "POST", body: JSON.stringify({ pid }) }),
  tasks: (query: TaskQuery) => call<TasksResponse>(`/api/tasks?${taskQueryString(query)}`),
  filterOptions: () => call<FilterOptions>("/api/tasks/options"),
  move: (body: { taskId: number; status?: { id: number; name: string; color: string } | null; prevRank: number | null; nextRank: number | null; origin?: string }) =>
    call<MoveResult>("/api/kanban/move", { method: "POST", body: JSON.stringify(body) }),
  rebalance: (ranks: { id: number; rank: number }[], origin?: string) => call<{ ok: true; ranks: { id: number; rank: number }[] }>("/api/kanban/rebalance", { method: "POST", body: JSON.stringify({ ranks, origin }) }),
  assign: (body: { taskId: number; assignees: { id: number; name: string; avatar: string | null }[]; origin?: string }) =>
    call<{ ok: true; taskId: number; assignees: { id: number; name: string; avatar: string | null }[] }>("/api/kanban/assign", { method: "POST", body: JSON.stringify(body) }),
  views: () => call<{ ok: true; views: SavedView[] }>("/api/kanban/views"),
  view: (id: string) => call<{ ok: true; view: SavedView & { state: ViewState } }>(`/api/kanban/views/${encodeURIComponent(id)}`),
  saveView: (body: { name: string; board: string; state: ViewState }) => call<{ ok: true; view: SavedView }>("/api/kanban/views", { method: "POST", body: JSON.stringify(body) }),
  deleteView: (id: string) => call<{ ok: true }>(`/api/kanban/views/${encodeURIComponent(id)}`, { method: "DELETE" }),
  realtimeConfig: () => call<{ ok: true; enabled: boolean; config: { key: string; cluster: string; wsHost?: string; wsPort?: number; wssPort?: number; forceTLS?: boolean } | null }>("/api/realtime/config"),
  prefs: (board: string) => call<{ ok: true; prefs: BoardPrefs | null }>(`/api/kanban/prefs/${encodeURIComponent(board)}`),
  savePrefs: (board: string, prefs: BoardPrefs) => call<{ ok: true; prefs: BoardPrefs }>(`/api/kanban/prefs/${encodeURIComponent(board)}`, { method: "PUT", body: JSON.stringify(prefs) }),
  resetOrder: (origin?: string) => call<{ ok: true }>("/api/kanban/reset", { method: "POST", body: JSON.stringify({ origin }) }),
};
