import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { apiOriginCsp } from "./vite-plugins/api-origin-csp.ts";

const PRODUCTION_API_URL = "https://api.munhub.in/api/v1";

export default defineConfig(({ mode }) => ({
  // apiOriginCsp: dist/_headers' CSP allows the API this build calls (e.g. staging).
  plugins: [react(), tailwindcss(), apiOriginCsp()],
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React/ReactDOM/scheduler churn far less often than app code (a
          // version bump, not every deploy), but without this they get
          // bundled inline with whichever entry first pulls them in — so a
          // repeat visitor re-downloads React itself after every unrelated
          // app change. Pulling just these three into their own chunk keeps
          // them cacheable across deploys without merging other, actually
          // route-scoped vendor deps (e.g. @base-ui/react, sonner) into one
          // another the way a blanket "all of node_modules" rule would.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }
        },
      },
    },
  },
}));
