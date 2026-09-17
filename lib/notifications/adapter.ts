export interface NotificationPayload {
  to: string
  subject: string
  /** Plain-text body — always required, even when `html` is also given, as the fallback for clients that don't render HTML. */
  body: string
  /** Optional pre-rendered HTML (e.g. lib/notifications/templates/otp-email.ts). Adapters that support HTML send it verbatim, never re-deriving it from `body`. */
  html?: string
}

/**
 * Notification provider interface. Console-logging implementation now; a
 * real email provider implements the same interface later, call sites
 * unchanged.
 */
export interface NotificationsAdapter {
  send(notification: NotificationPayload): Promise<void>
}
