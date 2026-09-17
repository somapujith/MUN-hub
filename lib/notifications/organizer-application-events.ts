import { getNotificationsAdapter } from './select-adapter'
import type { NotificationsAdapter } from './adapter'

// -----------------------------------------------------------------------------
// organizer-application-events — Gate 1 (organizer-APPLICATION review)
// decision emails: "is this organizer allowed to host at all," a completely
// different concept from pipeline-events.ts's PipelineEvent union, which is
// scoped to Gate 2 (mun-CONTENT review) and the post-publish mun lifecycle.
//
// Deliberately a SEPARATE type/file, not new variants on PipelineEvent —
// PipelineEvent already has APPROVED/CHANGES_REQUESTED members with Gate-2
// meanings ("this mun's submitted content passed/needs changes"). Reusing
// those same literal names here for "this organizer's application to host
// was approved/needs changes" would be exactly the Gate-1/Gate-2 collision
// trap mun-state-machine.ts's header comment warns about for MunStatus
// values — the same discipline applies to notification event types.
// pipeline-events.ts itself is a peer-owned file and is not modified here.
// -----------------------------------------------------------------------------

export type OrganizerApplicationEvent =
  | { type: 'APPLICATION_APPROVED'; munId: string; organizerEmail: string; munName: string }
  | { type: 'APPLICATION_CHANGES_REQUESTED'; munId: string; organizerEmail: string; munName: string; reason: string }
  | { type: 'APPLICATION_REJECTED'; munId: string; organizerEmail: string; munName: string; reason: string }

export interface RenderedApplicationNotification {
  to: string
  subject: string
  body: string
}

/** Pure render — no I/O, mirrors pipeline-events.ts's renderPipelineNotification shape. */
export function renderOrganizerApplicationNotification(event: OrganizerApplicationEvent): RenderedApplicationNotification {
  switch (event.type) {
    case 'APPLICATION_APPROVED':
      return {
        to: event.organizerEmail,
        subject: `You're approved to host on MUN Hub — ${event.munName}`,
        body: `Your application to host "${event.munName}" on MUN Hub has been approved. You can now start onboarding your conference's details.`,
      }
    case 'APPLICATION_CHANGES_REQUESTED':
      return {
        to: event.organizerEmail,
        subject: `Changes requested on your MUN Hub application — ${event.munName}`,
        body: `Your application to host "${event.munName}" on MUN Hub needs changes before it can be approved: ${event.reason}`,
      }
    case 'APPLICATION_REJECTED':
      return {
        to: event.organizerEmail,
        subject: `Update on your MUN Hub application — ${event.munName}`,
        body: `Your application to host "${event.munName}" on MUN Hub was not approved: ${event.reason}`,
      }
  }
}

/**
 * Renders and sends a Gate-1 decision notification. Delivery failures are
 * caught and logged, never thrown — same "a notification failure must never
 * fail the decision that triggered it" rule as notifyPipelineEvent. Callers
 * fire this AFTER their own triggering transaction has committed, never
 * inside it (see pipeline-events.ts's notifyPipelineEvent and every
 * lib/lifecycle call site for the same convention).
 */
export async function notifyOrganizerApplicationEvent(
  event: OrganizerApplicationEvent,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<void> {
  const rendered = renderOrganizerApplicationNotification(event)
  try {
    await adapter.send({ to: rendered.to, subject: rendered.subject, body: rendered.body })
  } catch (error) {
    console.error('[organizer-application-notification] delivery failed', { event: event.type, to: rendered.to, error })
  }
}
