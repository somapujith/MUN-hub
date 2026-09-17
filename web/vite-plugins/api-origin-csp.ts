import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

// public/_headers (copied into dist/ as-is) carries the production CSP, whose
// connect-src allows only https://api.munhub.in. A build pointed at another
// API — the staging Worker (docs/operations/ENVIRONMENTS.md), or anything
// else set through VITE_API_URL — would have every API call blocked by that
// policy. This plugin adds the origin the bundle actually calls to
// connect-src in dist/_headers after the build. A production build already
// matches, so its output is unchanged. web/vercel.json (munhub.in / www,
// production API only) is static and needs no rewrite.

/** What src/api/*.ts fall back to when VITE_API_URL isn't baked in. */
const CLIENT_FALLBACK_API_URL = "http://localhost:3001/api/v1";

const CSP_LINE = /^([ \t]*Content-Security-Policy:)(.*)$/gim;

/** The http(s) origin of `apiUrl`, or null for a relative URL (covered by 'self') or another scheme. */
export function apiOriginOf(apiUrl: string): string | null {
  try {
    const url = new URL(apiUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Adds `origin` to connect-src in every Content-Security-Policy line of a
 * Cloudflare `_headers` file; returns the text unchanged when it's already
 * listed. Throws if a policy has no connect-src — it would fall back to
 * default-src and block the API even in production.
 */
export function allowConnectOrigin(headers: string, origin: string): string {
  return headers.replace(CSP_LINE, (_line, name: string, policy: string) => {
    const directives = policy.split(";");
    const index = directives.findIndex((directive) => /^\s*connect-src(\s|$)/i.test(directive));
    if (index === -1) throw new Error(`_headers: Content-Security-Policy has no connect-src directive to add ${origin} to`);

    const [directiveName, ...sources] = directives[index].trim().split(/\s+/);
    if (sources.includes(origin)) return `${name}${policy}`;

    const leading = directives[index].match(/^\s*/)?.[0] ?? "";
    directives[index] = `${leading}${[directiveName, ...sources, origin].join(" ")}`;
    return `${name}${directives.join(";")}`;
  });
}

/** The API base URL a build bakes in: a `define` override wins over the loaded env, as in Vite's define plugin. */
function bakedApiUrl(define: Record<string, unknown> | undefined, env: Record<string, unknown>): string {
  const defined = define?.["import.meta.env.VITE_API_URL"];
  if (typeof defined === "string") {
    try {
      const parsed: unknown = JSON.parse(defined);
      if (typeof parsed === "string") return parsed;
    } catch {
      // not a JSON string literal; fall through to the env
    }
  }
  const fromEnv = env.VITE_API_URL;
  return typeof fromEnv === "string" ? fromEnv : CLIENT_FALLBACK_API_URL;
}

export function apiOriginCsp(): Plugin {
  let headersFile: string | null = null;
  let origin: string | null = null;

  return {
    name: "munhub:api-origin-csp",
    apply: "build",
    configResolved(config) {
      headersFile = config.build.write ? path.resolve(config.root, config.build.outDir, "_headers") : null;
      origin = apiOriginOf(bakedApiUrl(config.define, config.env));
    },
    writeBundle() {
      if (!headersFile || !origin || !fs.existsSync(headersFile)) return;
      const before = fs.readFileSync(headersFile, "utf8");
      const after = allowConnectOrigin(before, origin);
      if (after !== before) fs.writeFileSync(headersFile, after);
    },
  };
}
