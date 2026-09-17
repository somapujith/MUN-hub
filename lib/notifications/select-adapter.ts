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
 * **No token is not an error, on any environment.** An earlier version threw
 * here when `process.env.NODE_ENV === 'production'`, to stop a misconfigured
 * deployment printing OTP codes and password-reset links into server logs.
 * That guard was removed because (a) it fired far more widely than intended
 * — Wrangler statically replaces `process.env.NODE_ENV` with `'production'`
 * in *every* deployed bundle, staging included, so a documented no-token
 * staging deploy (docs/operations/ENVIRONMENTS.md step 3, RUNBOOK.md's
 * configuration table) had every send fail: organizer sign-in codes 503'd
 * and each cron run reported a failure; and (b) the leak it guarded against
 * is already closed at the source — `consoleNotificationsAdapter` redacts
 * the message body (and masks the recipient) whenever `isProductionRuntime()`
 * is true, which covers Workers and `NODE_ENV=production` alike. The
 * remaining log line is a masked recipient plus a subject, which is exactly
 * the "mail is written to the Worker log" behaviour the operations docs
 * promise. Do not reintroduce a throw here without also changing those docs:
 * `getNotificationsAdapter()` is evaluated as a default parameter by the
 * cron jobs (reminder-job.ts, organizer-digest-job.ts) and awaited directly
 * by organizer-otp.ts, which turns a throw into a user-visible 503.
 */
export function getNotificationsAdapter(): NotificationsAdapter {
  return getRuntimeEnv('ZEPTOMAIL_TOKEN') ? zeptoMailNotificationsAdapter : consoleNotificationsAdapter
}
