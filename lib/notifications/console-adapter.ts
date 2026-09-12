import type { NotificationPayload, NotificationsAdapter } from './adapter'

export const consoleNotificationsAdapter: NotificationsAdapter = {
  async send(notification: NotificationPayload): Promise<void> {
    console.log('[notification]', notification.to, notification.subject, notification.body)
  },
}
