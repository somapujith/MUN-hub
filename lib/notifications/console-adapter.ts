import { isProductionRuntime } from '@/lib/runtime-platform'
import type { NotificationPayload, NotificationsAdapter } from './adapter'

/** `a***@example.com` — enough to correlate a log line, not enough to harvest addresses. */
function maskEmail(address: string): string {
  const at = address.indexOf('@')
  return at > 0 ? `${address[0]}***${address.slice(at)}` : '***'
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
  },
}
