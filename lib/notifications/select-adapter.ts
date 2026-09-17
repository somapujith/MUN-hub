import { getRuntimeEnv } from '@/lib/runtime-env'
import { consoleNotificationsAdapter } from './console-adapter'
import { zeptoMailNotificationsAdapter } from './zeptomail-adapter'
import type { NotificationsAdapter } from './adapter'

/**
 * Picks the active notifications adapter: real email via ZeptoMail when
 * `ZEPTOMAIL_TOKEN` is configured, otherwise the console/mock adapter — local
 * dev without credentials, and every test run (`.env.test` deliberately never
 * sets `ZEPTOMAIL_TOKEN`, matching the DB-isolation convention this repo
 * already follows for the same reason: a test run must never touch a real
 * external system). Call this fresh at each send site rather than caching
 * its result — env can change between cold starts.
 *
 * **Production security guard** (audit finding: "console adapter logs OTP/
 * reset links"): in production (`process.env.NODE_ENV === 'production'` —
 * read directly, not via `getRuntimeEnv`, since `NODE_ENV` is the one var
 * Workers' bundler DOES statically replace, same as
 * server/lib/boot-guard.ts's identical check), a missing `ZEPTOMAIL_TOKEN`
 * throws instead of silently falling back to the console adapter — a
 * misconfigured deployment would otherwise print OTP codes and password-
 * reset links to server logs, which are far more widely readable than the
 * intended recipient's inbox. Every real call site of this function is
 * fire-and-forget (wrapped in a `.catch(...)` by its caller — see
 * pipeline-events.ts / go-live.ts's file header for the convention), and a
 * thrown default-parameter expression inside an `async function` becomes a
 * rejected promise, not a synchronous throw, so this can never crash the
 * action that triggered the notification — it only ever surfaces as a
 * logged delivery failure, same as a real network error would. Local dev
 * and every test run are unaffected: `NODE_ENV` is never `'production'`
 * there.
 */
export function getNotificationsAdapter(): NotificationsAdapter {
  if (getRuntimeEnv('ZEPTOMAIL_TOKEN')) return zeptoMailNotificationsAdapter

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to fall back to the console notifications adapter in production — ZEPTOMAIL_TOKEN is not configured. ' +
        'Set it before deploying; the console adapter would otherwise leak OTP codes and password-reset links into server logs.',
    )
  }

  return consoleNotificationsAdapter
}
