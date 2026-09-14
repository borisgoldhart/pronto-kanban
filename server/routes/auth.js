import { asyncRouter } from "../async-router.js";
import { config, listEnvironments, resolveEnvironment, environmentLabel, normaliseBaseUrl } from "../config.js";
import { authMode } from "../session.js";
import { loginUser, getSession, destroySession, sidCookie, envBypassCookie, brokerStart, brokerPoll } from "../users.js";
import { prontoFetch } from "../pronto.js";

const router = asyncRouter();

/** Who am I / how is auth set up (see the Reporting Dashboard for the contract). */
router.get("/status", (req, res) => {
  const p = req.pronto || { mode: "none", identity: null, key: "anon" };
  const baseUrl = p.baseUrl || config.prontoBaseUrl;
  res.json({
    // The Pronto environment THIS session is signed into (or the default before sign-in).
    baseUrl,
    environment: { baseUrl, label: environmentLabel(baseUrl), isDefault: baseUrl.toLowerCase() === config.prontoBaseUrl.toLowerCase() },
    // Login-screen picker: presets + whether a custom URL may be typed.
    environments: listEnvironments(),
    allowCustomEnvironment: config.allowCustomEnvironment,
    mode: p.mode,
    envMode: authMode(),
    authRequired: p.mode === "none",
    identity: p.identity,
    userKey: p.key,
    tokenGeneratorUrl: config.tokenGeneratorUrl || null,
    broker: !config.brokerDisabled,
  });
});

/** Environment chosen on the login screen (body.baseUrl). Presets match by URL;
 *  a custom URL is honoured only when PRONTO_ALLOW_CUSTOM_ENV is on. Returns
 *  { env } or { error } when the user asked for something we refuse. */
function pickEnvironment(req) {
  const requested = String((req.body || {}).baseUrl || "").trim();
  if (!requested) return { env: resolveEnvironment("") };                       // default environment
  if (!normaliseBaseUrl(requested)) return { error: `"${requested}" is not a valid Pronto URL. Use https://<host>.` };
  const env = resolveEnvironment(requested);
  if (env.rejected) return { error: `Custom Pronto URLs are disabled on this deployment (${env.rejected})` };
  return { env };
}

/** PKCE broker: start a "Sign in with HavasPronto" attempt (on the chosen environment). */
router.post("/broker/start", async (req, res) => {
  if (config.brokerDisabled) return res.status(404).json({ ok: false, error: "Broker sign-in is disabled" });
  const pick = pickEnvironment(req);
  if (pick.error) return res.status(400).json({ ok: false, error: pick.error });
  const returnUrl = `${req.protocol}://${req.get("host")}/auth/callback`;
  const r = await brokerStart(returnUrl, pick.env.baseUrl);
  if (!r.ok) return res.status(r.status || 502).json({ ok: false, error: r.error });
  res.json({ ok: true, pid: r.pid, loginUrl: r.loginUrl, pollMs: 3000, environment: { baseUrl: pick.env.baseUrl, label: pick.env.label } });
});

/** Poll the broker attempt until the user finishes logging in on the site. */
router.post("/broker/poll", async (req, res) => {
  const r = await brokerPoll((req.body || {}).pid);
  if (r.ok && r.pending) return res.json({ ok: true, pending: true, retryAfter: r.retryAfter });
  if (r.ok && r.sid) {
    res.setHeader("Set-Cookie", [sidCookie(r.sid), envBypassCookie(false)]);
    return res.json({ ok: true, identity: r.identity, baseUrl: r.baseUrl });
  }
  res.status(r.status || 400).json({ ok: false, error: r.error });
});

/** Per-user login: { email, password } OR { token }, plus optional { baseUrl } (environment). */
router.post("/login", async (req, res) => {
  const { token, email, password } = req.body || {};
  const pick = pickEnvironment(req);
  if (pick.error) return res.status(400).json({ ok: false, error: pick.error });
  const r = await loginUser({ token, email, password, baseUrl: pick.env.baseUrl });
  if (!r.ok) return res.status(r.status || 401).json({ ok: false, error: r.error });
  res.setHeader("Set-Cookie", [sidCookie(r.sid), envBypassCookie(false)]);
  res.json({ ok: true, identity: r.identity, baseUrl: r.baseUrl });
});

router.post("/logout", async (req, res) => {
  const s = await getSession(req);
  if (s) await destroySession(s.sid);
  res.setHeader("Set-Cookie", [sidCookie("", { destroy: true }), envBypassCookie(true)]);
  res.json({ ok: true });
});

/** Live check: one tiny Pronto API call proves the credentials work end-to-end. */
router.get("/verify", async (req, res) => {
  const p = req.pronto || { mode: "none" };
  if (p.mode === "none") {
    return res.status(401).json({ ok: false, authRequired: true, error: "Not signed in" });
  }
  const t0 = Date.now();
  const r = await prontoFetch(p.auth, "/v2/api/jobs", { query: { "page[limit]": 1 } });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r.ok) {
    return res.status(r.status || 502).json({ ok: false, mode: p.mode, user: p.identity, seconds, error: r.error, authRequired: r.authRequired });
  }
  res.json({ ok: true, mode: p.mode, user: p.identity, baseUrl: p.baseUrl || config.prontoBaseUrl, seconds });
});

export default router;
