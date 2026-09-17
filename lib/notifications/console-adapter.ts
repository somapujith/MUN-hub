import { appendFile } from 'node:fs/promises'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { isProductionRuntime } from '@/lib/runtime-platform'
import type { NotificationPayload, NotificationsAdapter } from './adapter'

/** `a***@example.com` — enough to correlate a log line, not enough to harvest addresses. */
function maskEmail(address: string): string {
  const at = address.indexOf('@')
  return at > 0 ? `${address[0]}***${address.slice(at)}` : '***'
}

/**
 * Dev/test-only outbox: when `EMAIL_OUTBOX_FILE` is set, appends one JSON
 * line per message (`{to, subject, text, html, sentAt}`) to that file, so an
 * E2E suite (Playwright, hitting a local `npm run dev` API server) can read
 * back recipients/subjects/links the console's stdout would otherwise
 * discard. Never active in production — `getNotificationsAdapter()` already
 * refuses to select this adapter at all in production without
 * `ZEPTOMAIL_TOKEN` (see select-adapter.ts), but this is checked again here
 * too as defense in depth against anything that might import and call this
 * adapter directly, bypassing that selection. Uses `node:fs/promises`
 * directly (not gated behind a dynamic import) — this file only ever runs
 * under local Node dev/test in practice (see the guard above), and Workers'
 * `nodejs_compat` flag (already enabled, see server/wrangler.jsonc) polyfills
 * it regardless.
 */
async function appendToOutbox(notification: NotificationPayload): Promise<void> {
  if (process.env.NODE_ENV === 'production') return

  const outboxFile = getRuntimeEnv('EMAIL_OUTBOX_FILE')
  if (!outboxFile) return

  const line =
    JSON.stringify({
      to: notification.to,
      subject: notification.subject,
      text: notification.body,
      html: notification.html ?? null,
      sentAt: new Date().toISOString(),
    }) + '\n'

  try {
    await appendFile(outboxFile, line, 'utf8')
  } catch (error) {
    // A broken outbox path must never break the (mock) send it's observing.
    console.error('[notification] outbox write failed', { outboxFile, error })
  }
}

export const consoleNotificationsAdapter: NotificationsAdapter = {
  async send(notification: NotificationPayload): Promise<void> {
    // Bodies carry live credentials (sign-in codes, password-reset links).
    // They reach the console only in local development — never on Workers or
    // with NODE_ENV=production, where logs are retained and shared.
    if (isProductionRuntime()) {
      console.log(
        '[notification]',
        maskEmail(notification.to),
        notification.subject,
        '(body redacted: the console adapter does not print message contents in production)',
      )
      return
    }

    console.log(
      '[notification]',
      notification.to,
      notification.subject,
      notification.body,
      notification.html ? '(html body present, not rendered to console)' : '',
    )
    await appendToOutbox(notification)
  },
}
