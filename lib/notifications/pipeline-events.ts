import { getNotificationsAdapter } from './select-adapter'
import type { NotificationsAdapter } from './adapter'
import {
  renderOrganizerDecisionEmailHtml,
  renderOrganizerDecisionEmailText,
} from './templates/organizer-decision-email'
import {
  renderOrganizerPublishedEmailHtml,
  renderOrganizerPublishedEmailText,
} from './templates/organizer-published-email'

// Mirrors the literal in lib/actions/organizer-otp.ts's own
// ORGANIZER_SUPPORT_EMAIL constant — kept as a separate local literal
// (not imported) so this framework-agnostic notifications module doesn't
// pull in that action's db/auth-layer dependency graph.
const ORGANIZER_SUPPORT_EMAIL = 'organizers@munhub.in'

// -----------------------------------------------------------------------------
// PipelineEvent — the organizer-facing variants here are deliberately just
// the terminal/actionable ones (APPROVED, CHANGES_REQUESTED,
// MODULE_ACTION_REQUIRED, PUBLISHED). The earlier "process narration" events
// (ONBOARDING_STARTED, READY_FOR_SUBMISSION, SUBMISSION_RECEIVED,
// UNDER_REVIEW, PUBLISHING, SLA_DELAY) were removed outright — a product
// decision, not something to re-add without asking first.
// -----------------------------------------------------------------------------

export type PipelineEvent =
  | {
      type: 'MODULE_ACTION_REQUIRED'
      munId: string
      organizerEmail: string
      munName: string
      moduleName: string
      issues: string[]
    }
  | {
      type: 'CHANGES_REQUESTED'
      munId: string
      organizerEmail: string
      munName: string
      moduleName: string
      reason: string
    }
  | { type: 'APPROVED'; munId: string; organizerEmail: string; munName: string }
  | { type: 'PUBLISHED'; munId: string; organizerEmail: string; munName: string; publicUrl: string }
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
  /**
   * Pre-rendered HTML for the branded organizer-decision/published emails.
   * Set for MODULE_ACTION_REQUIRED, CHANGES_REQUESTED, APPROVED and
   * PUBLISHED; left `undefined` for every other (plain-text, admin-facing)
   * case.
   */
  html?: string
}

/**
 * Pure render of a pipeline event into notification content — no I/O.
 * `to` is always an array here (one or more recipients); the adapter's
 * `NotificationPayload.to` is a single string, so `notifyPipelineEvent`
 * fans this out into one `send()` call per recipient.
 */
export function renderPipelineNotification(event: PipelineEvent): RenderedNotification {
  switch (event.type) {
    case 'MODULE_ACTION_REQUIRED': {
      const reason = event.issues.map((issue) => `- ${issue}`).join('\n')
      const input = {
        munName: event.munName,
        area: `the ${event.moduleName} section`,
        decision: 'CHANGES_REQUESTED' as const,
        reason,
        supportEmail: ORGANIZER_SUPPORT_EMAIL,
      }
      return {
        to: [event.organizerEmail],
        subject: `Action required on ${event.moduleName} — ${event.munName}`,
        body: renderOrganizerDecisionEmailText(input),
        html: renderOrganizerDecisionEmailHtml(input),
      }
    }
    case 'CHANGES_REQUESTED': {
      const input = {
        munName: event.munName,
        area: 'your MUN submission',
        decision: 'CHANGES_REQUESTED' as const,
        reason: event.reason,
        supportEmail: ORGANIZER_SUPPORT_EMAIL,
      }
      return {
        to: [event.organizerEmail],
        subject: `Changes requested — ${event.munName}`,
        body: renderOrganizerDecisionEmailText(input),
        html: renderOrganizerDecisionEmailHtml(input),
      }
    }
    case 'APPROVED': {
      const input = {
        munName: event.munName,
        area: 'your MUN submission',
        decision: 'APPROVED' as const,
        supportEmail: ORGANIZER_SUPPORT_EMAIL,
      }
      return {
        to: [event.organizerEmail],
        subject: `${event.munName} approved — you're on your way to going live`,
        body: renderOrganizerDecisionEmailText(input),
        html: renderOrganizerDecisionEmailHtml(input),
      }
    }
    case 'PUBLISHED': {
      const input = {
        munName: event.munName,
        publicUrl: event.publicUrl,
        supportEmail: ORGANIZER_SUPPORT_EMAIL,
      }
      return {
        to: [event.organizerEmail],
        subject: `"${event.munName}" is live!`,
        body: renderOrganizerPublishedEmailText(input),
        html: renderOrganizerPublishedEmailHtml(input),
      }
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
        await adapter.send({ to, subject: rendered.subject, body: rendered.body, html: rendered.html })
      } catch (error) {
        console.error('[pipeline-notification] delivery failed', { event: event.type, to, error })
      }
    }),
  )
}
