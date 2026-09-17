import { createMiddleware } from 'hono/factory'
import { runWithStorageBindings, type KvNamespaceLike, type R2BucketLike } from '@/lib/storage/bindings'
import type { AppVariables } from '../src/types'

type StorageEnv = {
  // server/wrangler.jsonc: "kv_namespaces" (UPLOADS_KV) and, once R2 is
  // enabled on the account, "r2_buckets" (UPLOADS_BUCKET). Both are absent
  // for local Node dev, where `c.env` is @hono/node-server's
  // `{ incoming, outgoing }`, and `c.env` itself is undefined under Hono's
  // `app.request()` test helper unless a test passes one.
  UPLOADS_BUCKET?: R2BucketLike
  UPLOADS_KV?: KvNamespaceLike
}

function hasMethod(value: unknown, method: string): boolean {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[method] === 'function'
}

/**
 * Hands the storage bindings and the request origin to lib/storage (see
 * lib/storage/bindings.ts) for the rest of this request. Runs `next()`
 * inside the AsyncLocalStorage scope, like hyperdriveMiddleware, so nothing
 * leaks into another request handled by the same isolate.
 */
export const storageMiddleware = createMiddleware<{
  Variables: AppVariables
  Bindings: StorageEnv
}>(async (c, next) => {
  const env = c.env as StorageEnv | undefined
  const r2 = hasMethod(env?.UPLOADS_BUCKET, 'get') ? env?.UPLOADS_BUCKET : undefined
  const kv = hasMethod(env?.UPLOADS_KV, 'getWithMetadata') ? env?.UPLOADS_KV : undefined

  let requestOrigin: string | undefined
  try {
    requestOrigin = new URL(c.req.url).origin
  } catch {
    requestOrigin = undefined
  }

  await runWithStorageBindings({ r2, kv, requestOrigin }, () => next())
})
