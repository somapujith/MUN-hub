import { getNotificationsAdapter } from './select-adapter'
import type { NotificationsAdapter } from './adapter'
import { renderOrganizerDecisionEmailHtml, renderOrganizerDecisionEmailText } from './templates/organizer-decision-email'

// Same literal as the un-exported `ORGANIZER_SUPPORT_EMAIL` constant in
// lib/actions/organizer-otp.ts (not exported there, so duplicated here —
// same pattern web/src/pages/organizer/organizer-login-page.tsx already
// uses). Keep in sync if that literal ever changes.
const ORGANIZER_SUPPORT_EMAIL = 'organizers@munhub.in'

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
  /** Branded HTML render from templates/organizer-decision-email.ts — set on every case; adapters that don't support HTML fall back to `body`. */
  html?: string
}

const APPLICATION_AREA = 'your organizer application'

/**
 * Pure render — no I/O, mirrors pipeline-events.ts's renderPipelineNotification
 * shape. Renders through the SAME templates/organizer-decision-email.ts
 * template pipeline-events.ts's Gate-2 APPROVED/CHANGES_REQUESTED cases use,
 * so Gate-1 (this file, "can you host at all") and Gate-2 ("is this mun's
 * content correct") decision emails look identical to the organizer —
 * different copy, one visual design. See this file's header comment for why
 * the two gates still stay separate types/event unions.
 */
export function renderOrganizerApplicationNotification(event: OrganizerApplicationEvent): RenderedApplicationNotification {
  switch (event.type) {
    case 'APPLICATION_APPROVED': {
      const input = {
        munName: event.munName,
        area: APPLICATION_AREA,
        decision: 'APPROVED' as const,
        supportEmail: ORGANIZER_SUPPORT_EMAIL,
      }
      // The templated main line covers the approval itself; this second
      // sentence is appended (not merged into the template) because it's
      // the only remaining place that tells a freshly-approved organizer
      // what to do next — the separate "onboarding started" email that
      // used to carry this call-to-action is being deleted elsewhere in
      // this same run.
      const nextStep = "You can now start onboarding your conference's details."
      return {
        to: event.organizerEmail,
        subject: `You're approved to host on MUN Hub — ${event.munName}`,
        body: `${renderOrganizerDecisionEmailText(input)}\n\n${nextStep}`,
        // The template has no slot for extra copy, so the next-step
        // sentence is spliced in just before the closing </body>. That
        // lands it directly on the page's dark outer background (outside
        // the white card), not on white, so it's styled like the
        // template's own "Have questions?" footer text (light color on
        // dark, centered, width-capped to match) rather than the darker
        // `#41454d` the template uses for text that sits on its white
        // card. Matched case-insensitively since this file can't assume
        // the sibling template's exact tag casing.
        html: renderOrganizerDecisionEmailHtml(input).replace(
          /<\/body>/i,
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#181d26;"><tr><td align="center"><p style="margin:16px 0 0; max-width:480px; font-size:14px; color:#c7c9cf; text-align:center;">${nextStep}</p></td></tr></table></body>`,
        ),
      }
    }
    case 'APPLICATION_CHANGES_REQUESTED': {
      const input = {
        munName: event.munName,
        area: APPLICATION_AREA,
        decision: 'CHANGES_REQUESTED' as const,
        reason: event.reason,
        supportEmail: ORGANIZER_SUPPORT_EMAIL,
      }
      return {
        to: event.organizerEmail,
        subject: `Changes requested on your MUN Hub application — ${event.munName}`,
        body: renderOrganizerDecisionEmailText(input),
        html: renderOrganizerDecisionEmailHtml(input),
      }
    }
    case 'APPLICATION_REJECTED': {
      const input = {
        munName: event.munName,
        area: APPLICATION_AREA,
        decision: 'REJECTED' as const,
        reason: event.reason,
        supportEmail: ORGANIZER_SUPPORT_EMAIL,
      }
      return {
        to: event.organizerEmail,
        subject: `Update on your MUN Hub application — ${event.munName}`,
        body: renderOrganizerDecisionEmailText(input),
        html: renderOrganizerDecisionEmailHtml(input),
      }
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
    await adapter.send({ to: rendered.to, subject: rendered.subject, body: rendered.body, html: rendered.html })
  } catch (error) {
    console.error('[organizer-application-notification] delivery failed', { event: event.type, to: rendered.to, error })
  }
}
