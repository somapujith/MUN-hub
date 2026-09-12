export interface NotificationPayload {
  to: string
  subject: string
  body: string
}

/**
 * Notification provider interface. Console-logging implementation now; a
 * real email provider implements the same interface later, call sites
 * unchanged.
 */
export interface NotificationsAdapter {
  send(notification: NotificationPayload): Promise<void>
}
