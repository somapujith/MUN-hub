import { createMiddleware } from 'hono/factory'
import { secureHeaders } from 'hono/secure-headers'
import type { AppVariables } from '../src/types'

/**
 * Security headers on every API response, errors and CORS preflights
 * included (registered ahead of everything that can produce a response).
 *
 * The API's own answers are JSON, XML (sitemap) and plain text (robots), never
 * HTML, so the default CSP is as strict as it gets: nothing may load, nothing
 * may frame it. Cross-Origin-Resource-Policy is `same-site` rather than hono's
 * default `same-origin` — CORP only applies to no-cors loads, and the web
 * hosts are same-site with api.munhub.in.
 */
const apiSecureHeaders = secureHeaders({
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  xContentTypeOptions: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  xFrameOptions: 'DENY',
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-site',
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
  },
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: [],
  },
})

/**
 * Headers a route may choose for itself. hono's secureHeaders overwrites its
 * headers after the handler runs, which would replace the per-file CSP
 * (`sandbox` for images, `object-src 'self'` so the browser PDF viewer can
 * load) and the `cross-origin` CORP that server/routes/files.ts sets on
 * uploaded files. A value the route set wins; every other response gets the
 * defaults above.
 */
const ROUTE_OWNED_HEADERS = ['Content-Security-Policy', 'Cross-Origin-Resource-Policy'] as const

export const securityHeadersMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  let routeSet: Array<[string, string]> = []
  await apiSecureHeaders(c, async () => {
    await next()
    routeSet = ROUTE_OWNED_HEADERS.flatMap((name): Array<[string, string]> => {
      const value = c.res.headers.get(name)
      return value === null ? [] : [[name, value]]
    })
  })
  for (const [name, value] of routeSet) c.res.headers.set(name, value)
})
