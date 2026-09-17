// Build-time rewriting of the CSP shipped in web/public/_headers.
//
// Vite copies public/_headers into dist/, and Cloudflare Workers Static Assets
// serves it (munhub-web, web/wrangler.jsonc). The `assets` block is inherited
// by env.staging, so the staging Worker serves the same file — but the staging
// bundle is built against a different API (VITE_API_URL=…workers.dev/api/v1),
// and the committed CSP only allows connections to https://api.munhub.in. The
// browser would block every API call the staging SPA makes.
//
// So the connect-src origin follows whichever API the bundle was built
// against: the plugin in vite.config.ts rewrites dist/_headers after the
// build. The committed file keeps the production value, which is what a plain
// `vite build` (and Vercel, which uses web/vercel.json instead) still ships.

/** The API origin the committed `_headers` / `vercel.json` CSP allows. */
export const PRODUCTION_API_ORIGIN = 'https://api.munhub.in'

/**
 * The origin of `apiUrl` (a full API base URL such as
 * `https://munhub-api-staging.example.workers.dev/api/v1`), or null when it is
 * unset or not a URL — in which case the committed CSP is left alone.
 */
export function resolveApiOrigin(apiUrl: string | undefined): string | null {
  if (!apiUrl) return null
  try {
    return new URL(apiUrl).origin
  } catch {
    return null
  }
}

/**
 * `headersText` with every `connect-src` directive pointed at `apiOrigin`
 * instead of the production API. The production origin is replaced rather than
 * added to: a bundle only ever talks to the one API it was built against.
 */
export function withApiOrigin(headersText: string, apiOrigin: string | null): string {
  if (!apiOrigin || apiOrigin === PRODUCTION_API_ORIGIN) return headersText

  // Only Content-Security-Policy lines: `_headers` also carries `#` comments,
  // which must never be rewritten into something Cloudflare parses.
  return headersText
    .split('\n')
    .map((line) => (/^\s*Content-Security-Policy:/i.test(line) ? rewriteConnectSrc(line, apiOrigin) : line))
    .join('\n')
}

function rewriteConnectSrc(cspLine: string, apiOrigin: string): string {
  return cspLine.replace(/connect-src(?=[\s;])[^;\n]*/g, (directive) => {
    const sources = directive.split(' ')
    if (sources.includes(apiOrigin)) return directive
    const productionIndex = sources.indexOf(PRODUCTION_API_ORIGIN)
    if (productionIndex === -1) return `${directive} ${apiOrigin}`
    sources[productionIndex] = apiOrigin
    return sources.join(' ')
  })
}
