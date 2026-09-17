import { SendMailClient } from 'zeptomail'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { NotificationPayload, NotificationsAdapter } from './adapter'

const ZEPTOMAIL_URL = 'https://api.zeptomail.in/v1.1/email'
const FROM_NAME = 'MUN Hub'

let cachedClient: SendMailClient | undefined
let cachedToken: string | undefined

/**
 * Lazily constructs (and caches) the ZeptoMail client, reading the token via
 * `getRuntimeEnv` rather than `process.env` directly — same reason
 * lib/crypto/field-encryption.ts's `loadKey` does this: under Cloudflare
 * Workers this module is evaluated once at cold start, before any request
 * (and therefore before `env`/secrets) exists, and Workers never populate
 * custom vars/secrets into `process.env` at all — only `NODE_ENV` is
 * special-cased. Re-checks the token on every call (cheap) and rebuilds the
 * client if it changed, so a cached client from an earlier cold start never
 * outlives a rotated token.
 */
function getClient(): SendMailClient {
  const token = getRuntimeEnv('ZEPTOMAIL_TOKEN')
  if (!token) {
    throw new Error('ZEPTOMAIL_TOKEN environment variable is not set — refusing to send email without it')
  }
  if (!cachedClient || cachedToken !== token) {
    cachedClient = new SendMailClient({ url: ZEPTOMAIL_URL, token })
    cachedToken = token
  }
  return cachedClient
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Every notification body in this codebase is plain text with `\n` line
 * breaks (see pipeline-events.ts/password-reset.ts) — never authored as
 * HTML. This is the one place that adapts it for an HTML-capable inbox;
 * `textbody` still carries the untouched original for clients that prefer it.
 */
function toHtmlBody(body: string): string {
  return `<div>${escapeHtml(body).replace(/\n/g, '<br>')}</div>`
}

/**
 * Real email delivery via ZeptoMail (https://www.zeptomail.in). Requires
 * `ZEPTOMAIL_TOKEN` (the Send Mail Token from the ZeptoMail dashboard) and
 * `ZEPTOMAIL_FROM_ADDRESS` (a sending address on a domain verified in
 * ZeptoMail) — both read via `getRuntimeEnv`, never a bare `process.env`
 * access (see `getClient`'s comment). Selected automatically by
 * `getNotificationsAdapter` (./select-adapter.ts) whenever `ZEPTOMAIL_TOKEN`
 * is set; local dev without credentials and every test run fall back to the
 * console adapter instead.
 */
export const zeptoMailNotificationsAdapter: NotificationsAdapter = {
  async send(notification: NotificationPayload): Promise<void> {
    const fromAddress = getRuntimeEnv('ZEPTOMAIL_FROM_ADDRESS')
    if (!fromAddress) {
      throw new Error('ZEPTOMAIL_FROM_ADDRESS environment variable is not set — refusing to send email without it')
    }

    await getClient().sendMail({
      from: { address: fromAddress, name: FROM_NAME },
      to: [{ email_address: { address: notification.to, name: notification.to } }],
      subject: notification.subject,
      textbody: notification.body,
      htmlbody: notification.html ?? toHtmlBody(notification.body),
    })
  },
}
