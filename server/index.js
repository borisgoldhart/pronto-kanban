import "dotenv/config";
import app, { serveStatic, config } from "./app.js";
import { authMode } from "./session.js";
import { kvEnabled, kvBackend } from "./kv.js";

serveStatic();

app.listen(config.port, () => {
  console.log(`\n  Pronto Kanban API`);
  console.log(`  ---------------------------------------`);
  console.log(`  Local:      http://localhost:${config.port}`);
  console.log(`  Pronto:     ${config.prontoBaseUrl}`);
  console.log(`  Auth mode:  ${authMode()}${authMode() === "none" ? "  (multi-user login mode)" : ""}`);
  console.log(`  Store:      ${kvEnabled ? `redis (${kvBackend})` : "in-memory + .cache file"}`);
  console.log(`  Fixtures:   ${process.env.KANBAN_FIXTURES === "1" ? "ON (captured Beta data)" : "off (live Pronto per signed-in user)"}\n`);
});
