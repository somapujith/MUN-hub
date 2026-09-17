import { getRuntimeEnv } from '@/lib/runtime-env'

/**
 * True inside Cloudflare Workers (the deployed API). Workers exposes
 * `navigator.userAgent === 'Cloudflare-Workers'`; Node reports its own
 * user agent (or has no `navigator` at all on older versions).
 */
export function isWorkersRuntime(): boolean {
  const { navigator } = globalThis as { navigator?: { userAgent?: string } }
  return navigator?.userAgent === 'Cloudflare-Workers'
}

/**
 * True when this process should behave as production: on Workers, or with
 * NODE_ENV=production. Checked both ways because Workers never puts
 * NODE_ENV into `process.env` for a dynamic lookup like getRuntimeEnv's
 * (see lib/runtime-env.ts), so NODE_ENV alone reads as unset there.
 */
export function isProductionRuntime(): boolean {
  return isWorkersRuntime() || getRuntimeEnv('NODE_ENV') === 'production'
}
