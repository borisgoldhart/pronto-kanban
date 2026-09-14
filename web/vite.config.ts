import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

// Dev: Vite serves the SPA and proxies the API to the Node server (npm run dev at the root).
// Build: static output in web/dist; pronto-base is copied into web/public/base beforehand.
// Bryntum: @bryntum/taskboard is an npm alias of the trial package (see package.json);
// switching to the licensed package changes only the alias.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ["@bryntum/taskboard"] },
  server: {
    port: 5174,
    proxy: { "/api": "http://localhost:8791", "/auth": "http://localhost:8791", "/base": "http://localhost:8791" },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 8000 },
});
