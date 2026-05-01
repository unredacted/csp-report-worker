/**
 * Vite config for the CSP report worker dashboard SPA.
 *
 * Project layout: the Worker lives in src/ and the SPA in dashboard/.
 * Vite's root is dashboard/ so index.html and module resolution stay clean.
 * Build output lands at dist/ (project root) so wrangler.toml's [assets]
 * binding can pick it up.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: "dashboard",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "dashboard/src"),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Forward API calls to the Worker on `wrangler dev` (port 8787)
      "/health": "http://localhost:8787",
      "/auth": "http://localhost:8787",
      "/report": "http://localhost:8787",
      "/reports": "http://localhost:8787",
    },
  },
});
