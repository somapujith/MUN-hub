import { getStorageBindings } from './bindings'
import { getRuntimeEnv } from '@/lib/runtime-env'

// Storage keys come from two places: upload actions build them
// (`muns/<munId>/<area>/<uuid>`), and GET /api/v1/files/:key reads them back
// out of a URL. The second is attacker-controlled, so every adapter and the
// files route check keys with `isSafeStorageKey` first.
//
// A safe key is 2+ `/`-separated segments of letters, digits, `.`, `_` and
// `-`, no longer than 512 bytes (the Workers KV key limit). A segment may not
// start with `.`, which rules out `.`, `..` and hidden files, so a key can
// never climb out of the local adapter's root directory.

const MAX_KEY_LENGTH = 512
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}$/

export function isSafeStorageKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false
  const segments = key.split('/')
  return segments.length >= 2 && segments.every((segment) => SEGMENT.test(segment))
}

export function assertSafeStorageKey(key: string): void {
  if (!isSafeStorageKey(key)) throw new Error('Invalid storage key')
}

export const FILES_ROUTE_PREFIX = '/api/v1/files/'

/**
 * The URL the web app uses to show a stored file.
 *
 * The web app and the API are on different origins in production
 * (organize.munhub.in vs api.munhub.in) and in dev (localhost:5174 vs
 * localhost:3001), so the URL must be absolute. The origin comes from:
 *   1. PUBLIC_API_URL (production: https://api.munhub.in), else
 *   2. the origin of the request that is uploading the file (local dev),
 *      recorded by server/middleware/storage.ts, else
 *   3. nothing: a root-relative path (callers outside an HTTP request,
 *      such as scripts and tests).
 * The key is also stored on the row, so the URL can be rebuilt if the API
 * host ever changes.
 */
export function publicFileUrl(key: string): string {
  const path = `${FILES_ROUTE_PREFIX}${key.split('/').map(encodeURIComponent).join('/')}`
  const origin = normalizeOrigin(getRuntimeEnv('PUBLIC_API_URL')) ?? normalizeOrigin(getStorageBindings()?.requestOrigin)
  return origin ? `${origin}${path}` : path
}

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}
