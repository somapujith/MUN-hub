import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { resolveApiOrigin, withApiOrigin } from "./build/security-headers.ts";

const PRODUCTION_API_URL = "https://api.munhub.in/api/v1";

/**
 * Points the CSP's connect-src at whichever API this bundle was built against.
 * public/_headers holds the production value; a build with VITE_API_URL set
 * elsewhere (staging, a preview) would otherwise ship a CSP that blocks every
 * one of its own API calls. See build/security-headers.ts.
 */
function apiConnectSrcHeaders(apiUrl: string | undefined): Plugin {
  let headersFile = "";
  let log: (message: string) => void = () => {};

  return {
    name: "munhub:api-connect-src",
    apply: "build",
    configResolved(config) {
      headersFile = path.resolve(config.root, config.build.outDir, "_headers");
      log = (message) => config.logger.info(message);
    },
    // The public directory is copied into outDir before the bundle is written,
    // so by now dist/_headers is the committed file, ready to rewrite.
    closeBundle() {
      const apiOrigin = resolveApiOrigin(apiUrl);
      if (!apiOrigin || !fs.existsSync(headersFile)) return;

      const original = fs.readFileSync(headersFile, "utf8");
      const rewritten = withApiOrigin(original, apiOrigin);
      if (rewritten !== original) {
        fs.writeFileSync(headersFile, rewritten);
        log(`_headers: CSP connect-src rewritten to allow ${apiOrigin}`);
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), apiConnectSrcHeaders(process.env.VITE_API_URL)],
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
