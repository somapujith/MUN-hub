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
 */
export function getNotificationsAdapter(): NotificationsAdapter {
  return getRuntimeEnv('ZEPTOMAIL_TOKEN') ? zeptoMailNotificationsAdapter : consoleNotificationsAdapter
}
