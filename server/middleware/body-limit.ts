import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import { base64LengthForBytes, MAX_UPLOAD_BYTES } from '@/lib/storage/validate'
import type { AppVariables } from '../src/types'

/** Every JSON route. Generous for any form payload this API accepts. */
export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024 // 1 MB

/**
 * Base64 upload routes: the largest allowed file once base64-encoded, plus
 * room for the surrounding JSON (kind, title, contentType). Derived from
 * lib/storage/validate.ts's UPLOAD_RULES so lowering a file cap lowers this
 * with it — a stale, far larger limit here let any signed-in caller make the
 * isolate buffer and decode tens of megabytes for a MUN they don't own.
 */
export const UPLOAD_BODY_LIMIT_BYTES = base64LengthForBytes(MAX_UPLOAD_BYTES) + 64 * 1024

// POST /api/v1/muns/:munId/documents (mun-documents.ts) and
// POST /api/v1/muns/:munId/media (mun-branding.ts).
const UPLOAD_ROUTE_PATTERN = /^\/api\/v1\/muns\/[^/]+\/(documents|media)\/?$/

function payloadTooLarge(c: Context) {
  return c.json(
    { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } },
    413,
  )
}

const defaultLimit = bodyLimit({ maxSize: DEFAULT_BODY_LIMIT_BYTES, onError: payloadTooLarge })
const uploadLimit = bodyLimit({ maxSize: UPLOAD_BODY_LIMIT_BYTES, onError: payloadTooLarge })

/**
 * Rejects oversized request bodies with a JSON 413 before anything reads them
 * (session lookup, rate-limit email keys, validators). Checks Content-Length
 * up front and counts streamed bytes when there is none.
 */
export const bodyLimitMiddleware = createMiddleware<{ Variables: AppVariables }>((c, next) => {
  const isUpload = c.req.method === 'POST' && UPLOAD_ROUTE_PATTERN.test(c.req.path)
  return (isUpload ? uploadLimit : defaultLimit)(c, next)
})
