import { getNotificationsAdapter } from './select-adapter'
import type { NotificationsAdapter } from './adapter'

export type PipelineEvent =
  | { type: 'ONBOARDING_STARTED'; munId: string; organizerEmail: string; munName: string }
  | {
      type: 'MODULE_ACTION_REQUIRED'
      munId: string
      organizerEmail: string
      munName: string
      moduleName: string
      issues: string[]
    }
  | { type: 'READY_FOR_SUBMISSION'; munId: string; organizerEmail: string; munName: string }
  | { type: 'SUBMISSION_RECEIVED'; munId: string; organizerEmail: string; munName: string }
  | { type: 'UNDER_REVIEW'; munId: string; organizerEmail: string; munName: string }
  | {
      type: 'CHANGES_REQUESTED'
      munId: string
      organizerEmail: string
      munName: string
      moduleName: string
      reason: string
    }
  | { type: 'APPROVED'; munId: string; organizerEmail: string; munName: string }
  | { type: 'PUBLISHING'; munId: string; organizerEmail: string; munName: string }
  | { type: 'PUBLISHED'; munId: string; organizerEmail: string; munName: string; publicUrl: string }
  | { type: 'SLA_DELAY'; munId: string; organizerEmail: string; munName: string }
  // admin-facing
  | { type: 'NEW_SUBMISSION'; munId: string; munName: string; adminEmails: string[] }
  | { type: 'RESUBMISSION'; munId: string; munName: string; adminEmails: string[] }
  | { type: 'PAYMENT_VERIFICATION_ISSUE'; munId: string; munName: string; adminEmails: string[] }
  | {
      type: 'CRITICAL_VALIDATION_FAILURE'
      munId: string
      munName: string
      adminEmails: string[]
      blockers: string[]
    }

export interface RenderedNotification {
  to: string[]
  subject: string
  body: string
}

/**
 * Pure render of a pipeline event into notification content — no I/O.
 * `to` is always an array here (one or more recipients); the adapter's
 * `NotificationPayload.to` is a single string, so `notifyPipelineEvent`
 * fans this out into one `send()` call per recipient.
 */
export function renderPipelineNotification(event: PipelineEvent): RenderedNotification {
  switch (event.type) {
    case 'ONBOARDING_STARTED':
      return {
        to: [event.organizerEmail],
        subject: `Welcome — let's get ${event.munName} live`,
        body: `Your MUN "${event.munName}" (${event.munId}) has started onboarding. Complete the required modules to submit for review.`,
      }
    case 'MODULE_ACTION_REQUIRED':
      return {
        to: [event.organizerEmail],
        subject: `Action required on ${event.moduleName} — ${event.munName}`,
        body: `The "${event.moduleName}" module for "${event.munName}" (${event.munId}) needs attention:\n${event.issues.map((issue) => `- ${issue}`).join('\n')}`,
      }
    case 'READY_FOR_SUBMISSION':
      return {
        to: [event.organizerEmail],
        subject: `${event.munName} is ready to submit`,
        body: `All required modules for "${event.munName}" (${event.munId}) are complete. You can now submit for MUNHub review.`,
      }
    case 'SUBMISSION_RECEIVED':
      return {
        to: [event.organizerEmail],
        subject: `Submission received — ${event.munName}`,
        body: `We've received your submission for "${event.munName}" (${event.munId}). Our team will begin review shortly.`,
      }
    case 'UNDER_REVIEW':
      return {
        to: [event.organizerEmail],
        subject: `${event.munName} is under review`,
        body: `"${event.munName}" (${event.munId}) is now under review by the MUNHub team.`,
      }
    case 'CHANGES_REQUESTED':
      return {
        to: [event.organizerEmail],
        subject: `Changes requested on ${event.moduleName} — ${event.munName}`,
        body: `The "${event.moduleName}" module for "${event.munName}" (${event.munId}) needs changes: ${event.reason}`,
      }
    case 'APPROVED':
      return {
        to: [event.organizerEmail],
        subject: `${event.munName} approved`,
        body: `"${event.munName}" (${event.munId}) has been approved and is now in the go-live queue.`,
      }
    case 'PUBLISHING':
      return {
        to: [event.organizerEmail],
        subject: `${event.munName} is publishing`,
        body: `"${event.munName}" (${event.munId}) is being published to the marketplace.`,
      }
    case 'PUBLISHED':
      return {
        to: [event.organizerEmail],
        subject: `${event.munName} is live!`,
        body: `"${event.munName}" (${event.munId}) is now live at ${event.publicUrl}.`,
      }
    case 'SLA_DELAY':
      return {
        to: [event.organizerEmail],
        subject: `Update on ${event.munName}'s review`,
        body: `Review of "${event.munName}" (${event.munId}) is taking longer than our usual turnaround. We appreciate your patience.`,
      }
    case 'NEW_SUBMISSION':
      return {
        to: event.adminEmails,
        subject: `New submission — ${event.munName}`,
        body: `"${event.munName}" (${event.munId}) has been submitted for review.`,
      }
    case 'RESUBMISSION':
      return {
        to: event.adminEmails,
        subject: `Resubmission — ${event.munName}`,
        body: `"${event.munName}" (${event.munId}) has been resubmitted after changes.`,
      }
    case 'PAYMENT_VERIFICATION_ISSUE':
      return {
        to: event.adminEmails,
        subject: `Payment verification issue — ${event.munName}`,
        body: `"${event.munName}" (${event.munId}) has a payment verification issue requiring attention.`,
      }
    case 'CRITICAL_VALIDATION_FAILURE':
      return {
        to: event.adminEmails,
        subject: `Critical validation failure — ${event.munName}`,
        body: `"${event.munName}" (${event.munId}) failed critical validation:\n${event.blockers.map((blocker) => `- ${blocker}`).join('\n')}`,
      }
  }
}

/**
 * Renders and sends a pipeline event notification, one `send()` call per
 * recipient (the adapter's NotificationPayload.to is a single string).
 * Delivery failures are caught and logged, never thrown — a notification
 * failure must never fail the pipeline transition that triggered it.
 *
 * `adapter` defaults to `getNotificationsAdapter()`, re-evaluated on every
 * call (a default parameter expression runs each time the arg is omitted,
 * not once at import time) so it always reflects the current environment —
 * real ZeptoMail delivery once `ZEPTOMAIL_TOKEN` is configured, console/mock
 * otherwise. Tests pass an explicit adapter and never hit this default.
 */
export async function notifyPipelineEvent(
  event: PipelineEvent,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<void> {
  const rendered = renderPipelineNotification(event)

  await Promise.all(
    rendered.to.map(async (to) => {
      try {
        await adapter.send({ to, subject: rendered.subject, body: rendered.body })
      } catch (error) {
        console.error('[pipeline-notification] delivery failed', { event: event.type, to, error })
      }
    }),
  )
}
