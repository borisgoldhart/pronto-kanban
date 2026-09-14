import { useState, type FormEvent } from "react";
import { api, type AuthStatus } from "./api";

/** Same contract as the Asset Library and Reporting Dashboard: "Sign in with
 *  HavasPronto" (PKCE broker), email + password, or a pasted API token. */
export function LoginScreen({ status, onSignedIn }: { status: AuthStatus | null; onSignedIn: () => void }) {
  const envs = status?.environments || [];
  const [env, setEnv] = useState<string>(status?.environment?.baseUrl || envs[0]?.baseUrl || "");
  const [customEnv, setCustomEnv] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const OTHER = "__other__";
  const baseUrl = env === OTHER ? customEnv.trim() : env;
  const envOk = env !== OTHER || Boolean(baseUrl);

  async function submit(body: Parameters<typeof api.login>[0], label: string) {
    if (!envOk) return setError("Enter the Pronto URL to use, or pick a preset.");
    setError(null); setBusy(label);
    try { await api.login({ ...body, baseUrl }); onSignedIn(); }
    catch (e) { setError((e as Error).message); setBusy(null); }
  }

  async function broker() {
    if (!envOk) return setError("Enter the Pronto URL to use, or pick a preset.");
    setError(null); setBusy("broker");
    const start = await api.brokerStart(baseUrl).catch((e: Error) => { setError(e.message); setBusy(null); return null; });
    if (!start) return;
    const popup = window.open(start.loginUrl, "_blank");
    if (popup) { try { popup.opener = null; } catch { /* cross-origin */ } }
    setNote(popup
      ? "Complete the sign-in in the Pronto tab. It closes by itself and this page finishes automatically."
      : "Popup blocked. Allow popups for this site, or complete the sign-in in another tab; this page finishes automatically.");
    const startedAt = Date.now();
    const poll = async (): Promise<void> => {
      if (Date.now() - startedAt > 5 * 60 * 1000) { setError("Timed out waiting for the Pronto sign-in. Try again."); setBusy(null); setNote(null); return; }
      try {
        const r = await api.brokerPoll(start.pid);
        if (r.pending) { setTimeout(poll, (r.retryAfter || start.pollMs / 1000 || 3) * 1000); return; }
        try { if (popup && !popup.closed) popup.close(); } catch { /* ignore */ }
        onSignedIn();
      } catch (e) {
        const err = e as { status?: number; message: string };
        if (err.status && err.status >= 500) { setTimeout(poll, 5000); return; }
        setError(err.message || "Pronto sign-in failed. Try again."); setBusy(null); setNote(null);
      }
    };
    setTimeout(poll, start.pollMs || 3000);
  }

  const onEmail = (e: FormEvent) => { e.preventDefault(); if (!email.trim() || !password) return setError("Enter your email and password."); submit({ email: email.trim(), password }, "email"); };
  const onToken = (e: FormEvent) => { e.preventDefault(); if (!token.trim()) return setError("Paste a token first."); submit({ token: token.trim() }, "token"); };

  return (
    <div className="login-screen">
      <div className="login-card">
        <img className="login-logo" src="/base/v1/img/havas-pronto-wide.png" alt="Havas Pronto"
          onError={(e) => { const img = e.currentTarget; img.onerror = null; img.src = "https://havaspronto.com/v2/build/images/logos/Havas-pronto-wide.png"; }} />
        <h2>Sign in to the Pronto Kanban</h2>
        <p className="login-sub">Use your HavasPronto.com account. Plans and projects respect your Pronto permissions.</p>

        {envs.length > 0 && (
          <div className="login-env">
            <label className="pp-label">Pronto environment
              <select id="l_env" className="pp-input" value={env} onChange={(e) => setEnv(e.target.value)}>
                {envs.map((x) => <option key={x.baseUrl} value={x.baseUrl}>{x.label}</option>)}
                {status?.allowCustomEnvironment && <option value={OTHER}>Other…</option>}
              </select>
            </label>
            {env === OTHER && <input id="l_envCustom" className="pp-input" type="text" inputMode="url" placeholder="https://your-pronto-host.com" value={customEnv} onChange={(e) => setCustomEnv(e.target.value)} />}
          </div>
        )}

        {status?.broker !== false && (
          <>
            <button id="brokerBtn" className="pp-btn pp-btn--primary login-btn" type="button" disabled={busy !== null} onClick={broker}>
              {busy === "broker" ? "Waiting for Pronto sign-in…" : "Sign in with HavasPronto"}
            </button>
            {note && <p className="login-note">{note}</p>}
            <div className="login-divider"><span>or with email &amp; password</span></div>
          </>
        )}

        <form id="loginForm" onSubmit={onEmail}>
          <label className="pp-label">Email<input id="l_email" className="pp-input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="pp-label">Password<input id="l_password" className="pp-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="pp-btn login-btn" type="submit" disabled={busy !== null}>{busy === "email" ? "Signing in…" : "Sign in"}</button>
          <p className="login-note">Your password is exchanged with Pronto for an API token and is never stored by this app.</p>
        </form>

        <div className="login-divider"><span>or use an API token</span></div>
        <form id="tokenForm" onSubmit={onToken}>
          <label className="pp-label">Bearer token<input id="l_token" className="pp-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste your Pronto API token" /></label>
          <div className="login-row">
            {status?.tokenGeneratorUrl && <a href={status.tokenGeneratorUrl} target="_blank" rel="noopener">Get a token ↗</a>}
            <button className="pp-btn login-btn" type="submit" disabled={busy !== null}>{busy === "token" ? "Signing in…" : "Sign in with token"}</button>
          </div>
        </form>

        {error && <div className="login-err" role="alert">{error}</div>}
      </div>
    </div>
  );
}
