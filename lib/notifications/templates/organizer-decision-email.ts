// -----------------------------------------------------------------------------
// organizer-decision-email — branded HTML for the single email organizers get
// for any admin review decision (organizer-application approval, MUN
// content-submission approval, or a single module sent back for changes).
// -----------------------------------------------------------------------------
//
// Structure mirrors lib/notifications/templates/otp-email.ts: dark page
// background, a white card, a white header band with the MUN Hub logo
// lockup, and the same "have questions" footer. All styles are inline
// (`style="..."` on every element) — email clients strip <style> blocks and
// ignore most CSS selectors, so nothing here relies on a stylesheet or
// `class`. Table-based layout (role="presentation") is used for the same
// Outlook-survival reasons documented there.

export interface OrganizerDecisionEmailInput {
  munName: string
  /** Short lowercase phrase for what was decided on, e.g. "your organizer application", "your MUN submission", "the Committees section" - the template embeds it into a sentence, so it must read naturally after "we've reviewed" or similar. */
  area: string
  decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED'
  /** Why, when decision isn't APPROVED. Optional even then - fall back to "See your dashboard for details." if omitted on a non-APPROVED decision. */
  reason?: string
  /** Already-resolved human labels of the specific fields that need correction, if the reviewer flagged any (Gate-1 organizer-application CHANGES_REQUESTED only, 2026-09-26). */
  fieldsRequiringCorrection?: string[]
  supportEmail: string
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const FALLBACK_REASON = 'See your dashboard for details.'

interface DecisionCopy {
  eyebrow: string
  eyebrowColor: string
  headline: (munName: string) => string
  body: (area: string, munName: string) => string
  reasonLabel: string
}

const DECISION_COPY: Record<OrganizerDecisionEmailInput['decision'], DecisionCopy> = {
  APPROVED: {
    eyebrow: 'APPROVED',
    eyebrowColor: '#006400',
    headline: (munName) => `"${munName}" is approved`,
    body: (area, munName) => `Good news - ${area} for "${munName}" has been approved.`,
    reasonLabel: '',
  },
  CHANGES_REQUESTED: {
    eyebrow: 'CHANGES REQUESTED',
    eyebrowColor: '#aa2d00',
    headline: (munName) => `Changes requested on "${munName}"`,
    body: (area, munName) => `${area} for "${munName}" needs a few changes before it can move forward.`,
    reasonLabel: 'What needs to change',
  },
  REJECTED: {
    eyebrow: 'UPDATE',
    eyebrowColor: '#aa2d00',
    headline: (munName) => `Update on "${munName}"`,
    body: (area, munName) => `${area} for "${munName}" was not approved this time.`,
    reasonLabel: 'Why',
  },
}

export function renderOrganizerDecisionEmailHtml(input: OrganizerDecisionEmailInput): string {
  const supportEmail = escapeHtml(input.supportEmail)
  const copy = DECISION_COPY[input.decision]

  const fieldsListHtml =
    input.fieldsRequiringCorrection && input.fieldsRequiringCorrection.length > 0
      ? `<ul style="margin:8px 0 0; padding-left:18px; text-align:left;">${input.fieldsRequiringCorrection
          .map((label) => `<li style="font-size:14px; color:#41454d;">${escapeHtml(label)}</li>`)
          .join('')}</ul>`
      : ''

  const reasonBlock =
    input.decision === 'APPROVED'
      ? ''
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                  <tr>
                    <td style="background-color:#fdf1ea; padding:16px; border-radius:8px; text-align:left;">
                      <p style="margin:0 0 4px; font-size:12px; font-weight:700; color:#181d26;">${escapeHtml(copy.reasonLabel)}</p>
                      <p style="margin:0; font-size:14px; color:#41454d;">${escapeHtml(input.reason ?? '') || FALLBACK_REASON}</p>
                      ${fieldsListHtml}
                    </td>
                  </tr>
                </table>`

  return `<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#181d26; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#181d26; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:12px; overflow:hidden;">
            <tr>
              <td style="background-color:#ffffff; padding:24px; text-align:center; border-bottom:1px solid #eef0f3;">
                <img src="https://www.munhub.in/images/logo-lockup.png" width="160" alt="MUN Hub" style="display:block; margin:0 auto; width:160px; max-width:100%; height:auto; border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:32px 24px; text-align:center;">
                <p style="margin:0 0 8px; font-size:12px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:${copy.eyebrowColor};">${escapeHtml(copy.eyebrow)}</p>
                <h1 style="margin:0 0 16px; font-size:22px; font-weight:700; color:#181d26;">${escapeHtml(copy.headline(input.munName))}</h1>
                <p style="margin:0; font-size:14px; color:#41454d;">${escapeHtml(copy.body(input.area, input.munName))}</p>
                ${reasonBlock}
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; margin-top:24px;">
            <tr>
              <td style="text-align:center;">
                <p style="margin:0 0 4px; font-size:13px; font-weight:700; color:#ffffff; letter-spacing:0.04em; text-transform:uppercase;">Have questions?</p>
                <p style="margin:0; font-size:13px; color:#c7c9cf;">
                  Mail us at <a href="mailto:${supportEmail}" style="color:#fcab79;">${supportEmail}</a>, and we'll help you out.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** Plain-text fallback for clients that don't render HTML — always send alongside the HTML body, never HTML alone. */
export function renderOrganizerDecisionEmailText(input: OrganizerDecisionEmailInput): string {
  const copy = DECISION_COPY[input.decision]
  const fieldsList =
    input.fieldsRequiringCorrection && input.fieldsRequiringCorrection.length > 0
      ? `\n${input.fieldsRequiringCorrection.map((label) => `- ${label}`).join('\n')}`
      : ''
  const reasonBlock =
    input.decision === 'APPROVED' ? '' : `\n\n${copy.reasonLabel}: ${input.reason || FALLBACK_REASON}${fieldsList}`

  return (
    `${copy.headline(input.munName)}\n` +
    `${copy.body(input.area, input.munName)}${reasonBlock}\n\n` +
    `Have questions? Mail us at ${input.supportEmail}, and we'll help you out.`
  )
}
