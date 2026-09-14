import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Load .env from the project root explicitly, so it works no matter which
// directory the process is launched from.
const envPath = path.join(projectRoot, ".env");
const envResult = dotenv.config({ path: envPath });
if (envResult.error) {
  console.warn(`[config] No .env found at ${envPath} (${envResult.error.code || "error"}). Using process env / defaults.`);
}

export const config = {
  prontoBaseUrl: (process.env.PRONTO_BASE_URL || "https://havaspronto.com").replace(/\/+$/, ""),
  // Selectable Pronto environments (login-screen picker). Each user's session is
  // pinned to the base URL they chose, so auth + SOLR search + binaries all hit
  // that host. Format: "Label|https://host,Label 2|https://host2". The default
  // PRONTO_BASE_URL is always included (first) even when not listed here.
  environmentsRaw: process.env.PRONTO_ENVIRONMENTS?.trim() || "",
  // Allow users to type any other https:// base URL ("Other" in the picker).
  allowCustomEnvironment: (process.env.PRONTO_ALLOW_CUSTOM_ENV ?? "true").trim().toLowerCase() !== "false",
  email: process.env.PRONTO_EMAIL?.trim() || "",
  password: process.env.PRONTO_PASSWORD || "",
  bearerToken: process.env.PRONTO_BEARER_TOKEN?.trim() || "",
  cookie: process.env.PRONTO_COOKIE?.trim() || "",
  port: Number(process.env.PORT) || 8791,
  // Where the .env single-identity fallback applies:
  //   "local" (default) — loopback requests only (your own browser on the dev box).
  //     Remote visitors (shared links, other computers) are NOT auto-signed-in.
  //   "all" — legacy behaviour: every cookie-less request runs as the env identity.
  //   "off" — never.
  envFallback: (process.env.PRONTO_ENV_FALLBACK || "local").trim().toLowerCase(),
  // Optional: page on havaspronto.com where users can generate an API token.
  // Shown as a "Get a token" link on the login screen when set.
  tokenGeneratorUrl: process.env.TOKEN_GENERATOR_URL?.trim() || "",
  // PKCE broker ("Sign in with HavasPronto") — endpoints hosted by the Pronto site.
  // Defaults derive from PRONTO_BASE_URL; override if the site moves them.
  pkceStartUrl: process.env.PRONTO_PKCE_START_URL?.trim() || "",
  pkceExchangeUrl: process.env.PRONTO_PKCE_EXCHANGE_URL?.trim() || "",
  brokerLoginUrl: process.env.PRONTO_BROKER_LOGIN_URL?.trim() || "",   // template; {txn_id} appended
  brokerDisabled: (process.env.PRONTO_BROKER ?? "").trim().toLowerCase() === "off",
  cacheEnabled: (process.env.CACHE_ENABLED ?? "true") !== "false",
  // On Vercel the deployment bundle is read-only; only /tmp is writable. Persistent
  // state lives in Redis (see kv.js); this path only backs the best-effort local
  // fallbacks (e.g. the env-mode token cache), so point it at /tmp there so those
  // writes don't throw against the read-only filesystem.
  cacheDir: process.env.CACHE_DIR
    ? path.resolve(projectRoot, process.env.CACHE_DIR)
    : (process.env.VERCEL ? "/tmp/.cache" : path.resolve(projectRoot, ".cache")),
};

/* ---- Pronto environments (per-session base URL) ---------------------------- */

const DEFAULT_ENVIRONMENTS = [
  { label: "Production (havaspronto.com)", baseUrl: "https://havaspronto.com" },
  { label: "Dev9 (SOLR on EBS test)", baseUrl: "https://dev9.app.dev.aws.pulseapi.com" },
];

/** Normalise a user/env-supplied base URL. Returns the canonical origin (no path,
 *  no trailing slash) or null when it is not an acceptable https host. */
export function normaliseBaseUrl(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  // Only real DNS names: no loopback/link-local/private literals (the proxy fetches
  // this URL server-side with the user's credentials attached).
  if (!host.includes(".") || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) return null;
  if (u.protocol === "http:" && !/\.(local|test|dev)$/.test(host)) return null;   // plain http only for obvious dev hosts
  return `${u.protocol}//${u.host}`;
}

function parseEnvironments(raw) {
  const out = [];
  for (const part of String(raw || "").split(/[,\n;]+/)) {
    const p = part.trim();
    if (!p) continue;
    const [a, b] = p.includes("|") ? p.split("|", 2) : ["", p];
    const baseUrl = normaliseBaseUrl(b || a);
    if (!baseUrl) { console.warn(`[config] PRONTO_ENVIRONMENTS: skipping unparseable entry "${p}"`); continue; }
    const label = (a || "").trim() || new URL(baseUrl).host;
    out.push({ label, baseUrl });
  }
  return out;
}

/** The list shown in the login-screen picker. The configured PRONTO_BASE_URL is
 *  always first (it is the default), then PRONTO_ENVIRONMENTS entries (or the
 *  built-in defaults when that variable is unset), de-duplicated by base URL. */
export function listEnvironments() {
  const seen = new Set();
  const out = [];
  const push = (e) => { const k = e.baseUrl.toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push(e); };
  const configured = parseEnvironments(config.environmentsRaw);
  const pool = configured.length ? configured : DEFAULT_ENVIRONMENTS;
  const def = pool.find((e) => e.baseUrl.toLowerCase() === config.prontoBaseUrl.toLowerCase());
  push(def || { label: new URL(config.prontoBaseUrl).host, baseUrl: config.prontoBaseUrl });
  for (const e of pool) push(e);
  return out.map((e, i) => ({ ...e, isDefault: i === 0 }));
}

/** Resolve the base URL a sign-in should use. Presets are matched by URL; a custom
 *  URL is accepted only when PRONTO_ALLOW_CUSTOM_ENV is on. Falls back to the
 *  default when nothing (valid) was chosen. Returns { baseUrl, label, custom }. */
export function resolveEnvironment(requested) {
  const envs = listEnvironments();
  const want = normaliseBaseUrl(requested);
  if (!want) return { ...envs[0], custom: false };
  const hit = envs.find((e) => e.baseUrl.toLowerCase() === want.toLowerCase());
  if (hit) return { ...hit, custom: false };
  if (!config.allowCustomEnvironment) return { ...envs[0], custom: false, rejected: want };
  return { label: new URL(want).host, baseUrl: want, custom: true, isDefault: false };
}

/** Short human label for a base URL (header badge). */
export function environmentLabel(baseUrl) {
  const b = String(baseUrl || config.prontoBaseUrl);
  const hit = listEnvironments().find((e) => e.baseUrl.toLowerCase() === b.toLowerCase());
  if (hit) return hit.label;
  try { return new URL(b).host; } catch { return b; }
}

// Auth lifecycle (login / token / headers) lives in session.js.
