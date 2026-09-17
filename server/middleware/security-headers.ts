import { secureHeaders } from 'hono/secure-headers'

/**
 * Security headers on every API response, errors and CORS preflights
 * included (registered ahead of everything that can produce a response).
 *
 * The API only ever serves JSON, XML (sitemap) and plain text (robots), never
 * HTML, so the CSP is as strict as it gets: nothing may load, nothing may frame
 * it. Cross-Origin-Resource-Policy is `same-site` rather than hono's default
 * `same-origin` — CORP only applies to no-cors loads, and the web hosts are
 * same-site with api.munhub.in.
 */
export const securityHeadersMiddleware = secureHeaders({
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
