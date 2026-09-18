// -----------------------------------------------------------------------------
// organizer-published-email — branded HTML for the "your MUN just went live"
// celebratory email an organizer gets once publishFromQueue actually
// publishes their MUN on the marketplace.
// -----------------------------------------------------------------------------
//
// Structure mirrors otp-email.ts: dark page background, a white rounded card,
// a white header band with the MUN Hub logo lockup, and the same "have
// questions" footer block. Table-based layout (role="presentation", inline
// styles only) since email clients strip <style> blocks and ignore most CSS
// selectors — nothing here relies on a stylesheet, `class`, flexbox, or grid.

export interface OrganizerPublishedEmailInput {
  munName: string
  publicUrl: string
  /** Shown in the footer's "Mail us at <supportEmail>" line. */
  supportEmail: string
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderOrganizerPublishedEmailHtml(input: OrganizerPublishedEmailInput): string {
  const munName = escapeHtml(input.munName)
  const publicUrl = escapeHtml(input.publicUrl)
  const supportEmail = escapeHtml(input.supportEmail)

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
                <p style="margin:0 0 8px; font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#006400;">Live</p>
                <h1 style="margin:0 0 16px; font-size:22px; font-weight:700; color:#181d26;">&ldquo;${munName}&rdquo; is live!</h1>
                <p style="margin:0 0 24px; font-size:14px; color:#41454d;">&ldquo;${munName}&rdquo; is now live on MUN Hub's marketplace &mdash; delegates can find it and start registering.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                  <tr>
                    <td style="border-radius:8px; background-color:#181d26;">
                      <a href="${publicUrl}" style="display:inline-block; padding:12px 24px; font-size:14px; font-weight:700; color:#ffffff; background-color:#181d26; border-radius:8px; text-decoration:none;">View your listing</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0; font-size:12px; color:#41454d; word-break:break-all;">
                  <a href="${publicUrl}" style="color:#aa2d00;">${publicUrl}</a>
                </p>
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
export function renderOrganizerPublishedEmailText(input: OrganizerPublishedEmailInput): string {
  return (
    `"${input.munName}" is live!\n` +
    `"${input.munName}" is now live on MUN Hub's marketplace - delegates can find it and start registering.\n\n` +
    `View your listing: ${input.publicUrl}\n\n` +
    `Have questions? Mail us at ${input.supportEmail}, and we'll help you out.`
  )
}
