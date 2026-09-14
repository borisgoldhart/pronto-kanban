// Copies the shared pronto-base package into web/public/base so Vite ships it
// with the static build (served as /base/v1/... by Vercel's CDN or by server/app.js).
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "pronto-base", "v1");
const dest = path.join(root, "web", "public", "base", "v1");
rmSync(dest, { recursive: true, force: true });
mkdirSync(path.dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`pronto-base copied to ${path.relative(root, dest)}`);
