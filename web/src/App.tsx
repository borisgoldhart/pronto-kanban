import { useCallback, useEffect, useState } from "react";
import { api, type AuthStatus } from "./api";
import { LoginScreen } from "./LoginScreen";
import { Banner, INBOX_TABS, PROJECT_TABS, Tabs } from "./chrome/PageChrome";
import { TaskWorkspace } from "./pages/TaskWorkspace";

declare global {
  interface Window { ProntoPage?: Record<string, unknown> & { user?: unknown; active?: string }; prontoLogout?: () => void }
}

/* ---- tiny router: /inbox/task-explorer  and  /projects/:id/kanban ---------- */
function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => { const h = () => setPath(window.location.pathname); window.addEventListener("popstate", h); return () => window.removeEventListener("popstate", h); }, []);
  const go = useCallback((to: string) => { window.history.pushState({}, "", to); setPath(to); }, []);
  return { path, go };
}

const DEMO_PROJECT = { id: 1530, title: "Kanban Enhancements (LATAM)" };

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const { path, go } = usePath();

  const refresh = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      window.ProntoPage = window.ProntoPage || {};
      window.ProntoPage.user = s.identity ? { name: s.identity.name || s.identity.email || "Signed in", href: "#" } : {};
      (document.querySelector("pronto-nav") as (Element & { refresh?: () => void }) | null)?.refresh?.();
    } catch { setStatus(null); }
    setChecked(true);
  }, []);

  useEffect(() => { refresh(); window.prontoLogout = async () => { try { await api.logout(); } catch { /* ignore */ } location.reload(); }; }, [refresh]);

  if (!checked) return <div className="pp-page pk-loading-page">Checking your session…</div>;
  if (!status || status.authRequired) return <LoginScreen status={status} onSignedIn={() => location.reload()} />;

  const prontoBase = status.environment?.baseUrl || status.baseUrl;
  const project = path.match(/^\/projects\/(\d+)\/kanban/);
  const viewId = new URLSearchParams(window.location.search).get("view");

  if (project) {
    const id = Number(project[1]);
    return (
      <div className="pp-page pk-page">
        <Banner title={id === DEMO_PROJECT.id ? DEMO_PROJECT.title : `Project ${id}`} code={String(id)} />
        <Tabs items={PROJECT_TABS} active="Tasks" />
        <TaskWorkspace scope="project" job={id} boardKey={`project:${id}`} title="Tasks" prontoBase={prontoBase} defaultGroupBy="none" viewId={viewId}
          groupOptions={[{ id: "none", label: "None" }, { id: "user", label: "User" }, { id: "department", label: "Department" }, { id: "priority", label: "Priority" }]} />
        <DemoSwitch current="project" go={go} />
      </div>
    );
  }

  return (
    <div className="pp-page pk-page">
      <Banner title="Inbox" />
      <Tabs items={INBOX_TABS} active="Task Explorer" />
      <TaskWorkspace scope="explorer" boardKey="explorer" title="All Tasks" prontoBase={prontoBase} defaultGroupBy="project" viewId={viewId} />
      <DemoSwitch current="explorer" go={go} />
    </div>
  );
}

/** Demo-only: jump between the two views. Not part of the design. */
function DemoSwitch({ current, go }: { current: "explorer" | "project"; go: (to: string) => void }) {
  return (
    <div className="pk-demo-switch" role="navigation" aria-label="Prototype views">
      <span>Prototype views:</span>
      <button type="button" className={current === "explorer" ? "is-active" : ""} onClick={() => go("/inbox/task-explorer")}>Task Explorer Kanban</button>
      <button type="button" className={current === "project" ? "is-active" : ""} onClick={() => go(`/projects/${DEMO_PROJECT.id}/kanban`)}>Project Kanban ({DEMO_PROJECT.id})</button>
    </div>
  );
}
