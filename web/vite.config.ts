import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const PRODUCTION_API_URL = "https://api.munhub.in/api/v1";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  // Every src/api/*.ts client falls back to http://localhost:3001 when
  // VITE_API_URL is unset. Vercel sets it, but the Cloudflare worker build
  // (`npm run cf:deploy`) didn't — so app./publish./admin.munhub.in shipped a
  // bundle that sent every API call to the visitor's own localhost. A
  // production build now defaults to the real API unless told otherwise;
  // local dev keeps the localhost fallback.
  define:
    mode === "production" && !process.env.VITE_API_URL
      ? { "import.meta.env.VITE_API_URL": JSON.stringify(PRODUCTION_API_URL) }
      : {},
}));
