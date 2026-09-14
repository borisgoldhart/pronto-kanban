/**
 * Kanban API. One Express app, mounted two ways:
 *   - server/index.js   long-lived process (local dev, Docker / ECS in the end state)
 *   - api/index.js      Vercel serverless function (prototype)
 * Static files (the Vite build in web/dist, pronto-base under /base) are served by
 * Vercel's CDN in the prototype and by this app everywhere else.
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { authMode } from "./session.js";
import { attachUser } from "./users.js";
import { kvEnabled, kvBackend } from "./kv.js";
import authRoutes from "./routes/auth.js";
import tasksRoutes from "./routes/tasks.js";
import kanbanRoutes from "./routes/kanban.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, "..", "web", "dist");
const baseDir = path.resolve(__dirname, "..", "pronto-base");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.use("/api", attachUser);                       // per-user session -> req.pronto
// Fixture mode (local dev, screenshots): no Pronto sign-in, a fixed demo identity.
if (process.env.KANBAN_FIXTURES === "1") {
  app.use("/api", (req, _res, next) => {
    if (req.pronto?.mode === "none") req.pronto = { ...req.pronto, mode: "demo", identity: { id: "685", email: "richard.smallwood@pronto.biz", name: "Richard Smallwood" }, key: "demo:685" };
    next();
  });
}
app.use("/api/auth", authRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/kanban", kanbanRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    authMode: authMode(),
    kv: { enabled: kvEnabled, backend: kvBackend },
    fixtures: process.env.KANBAN_FIXTURES === "1",
    writeStatus: process.env.KANBAN_WRITE_STATUS === "1",
    region: process.env.VERCEL_REGION || null,
  });
});

// Return page for the "Sign in with HavasPronto" popup.
app.get("/auth/callback", (_req, res) => {
  res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Signed in</title>
<body style="font:15px/1.5 Lato,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:96vh;color:#18181a">
<div style="text-align:center"><h2 style="margin:0 0 6px">Signed in</h2>
<p style="color:#666">You can close this tab and return to the Kanban.</p></div>
<script>setTimeout(function(){ window.close(); }, 800);</script></body>`);
});

// Errors as JSON, never an HTML stack trace.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ ok: false, error: err.message || "Server error" });
});

/** Static hosting for the long-lived process (Vercel serves these itself). */
export function serveStatic() {
  app.use("/base", express.static(baseDir, { etag: false, lastModified: false, setHeaders: (r) => r.setHeader("Cache-Control", "no-cache") }));
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, setHeaders: (r, f) => r.setHeader("Cache-Control", /\/assets\//.test(f) ? "public, max-age=31536000, immutable" : "no-cache") }));
    app.get(/^(?!\/api\/|\/base\/).*/, (_req, res) => { res.setHeader("Cache-Control", "no-store"); res.sendFile(path.join(webDist, "index.html")); });
  } else {
    app.get("/", (_req, res) => res.type("text").send("Front end not built yet: run `npm run build` (or `npm run dev` for Vite)."));
  }
}

export { config };
export default app;
