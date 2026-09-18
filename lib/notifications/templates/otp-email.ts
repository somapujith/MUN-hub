// -----------------------------------------------------------------------------
// otp-email — branded HTML for one-time-code emails (login OTP, etc.)
// -----------------------------------------------------------------------------
//
// Structure mirrors the reference the user provided (District by Zomato's OTP
// email): dark page background, a white card, a white header band with the
// MUN Hub logo lockup, "Your OTP for <purpose> is", a large code, an expiry
// note, and a "have questions" footer. Colors are MUN Hub's own
// (web/src/index.css) — ink #181d26 for the outer background, signature
// coral #aa2d00 for the code, not a copy of the reference's purple.
//
// All styles are inline (`style="..."` on every element) — email clients
// strip <style> blocks and ignore most CSS selectors, so nothing here can
// rely on a stylesheet, `class`, flexbox, or grid. Tables aren't used either
// since a single centered block doesn't need one; add table-based layout if
// a future template needs multi-column content to survive Outlook's Word
// rendering engine.

export interface OtpEmailInput {
  /** What the code is for, e.g. "login" or "signing up" — renders as "Your OTP for {purpose} is". */
  purpose: string
  code: string
  expiresInMinutes: number
  /** Shown in the footer's "Mail us at <supportEmail>" line. */
  supportEmail: string
  /** Optional hours string appended after supportEmail, e.g. "(10AM-7PM)" — omitted entirely if not given. */
  supportHours?: string
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderOtpEmailHtml(input: OtpEmailInput): string {
  const purpose = escapeHtml(input.purpose)
  const code = escapeHtml(input.code)
  const supportEmail = escapeHtml(input.supportEmail)
  const supportHours = input.supportHours ? ` (${escapeHtml(input.supportHours)})` : ''

  return `<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#181d26; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#181d26; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px; background-color:#ffffff; border-radius:12px; overflow:hidden;">
            <tr>
              <td style="background-color:#ffffff; padding:24px; text-align:center; border-bottom:1px solid #eef0f3;">
                <img src="https://www.munhub.in/images/logo-lockup.png" width="160" alt="MUN Hub" style="display:block; margin:0 auto; width:160px; max-width:100%; height:auto; border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:32px 24px; text-align:center;">
                <h1 style="margin:0 0 16px; font-size:22px; font-weight:700; color:#181d26;">Your one-time code</h1>
                <p style="margin:0 0 8px; font-size:14px; color:#41454d;">Your OTP for ${purpose} is</p>
                <p style="margin:0 0 8px; font-size:36px; font-weight:700; letter-spacing:0.08em; color:#181d26;">${code}</p>
                <p style="margin:0; font-size:12px; color:#aa2d00;">This is valid for ${input.expiresInMinutes} min${input.expiresInMinutes === 1 ? '' : 's'}</p>
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px; margin-top:24px;">
            <tr>
              <td style="text-align:center;">
                <p style="margin:0 0 4px; font-size:13px; font-weight:700; color:#ffffff; letter-spacing:0.04em; text-transform:uppercase;">Have questions?</p>
                <p style="margin:0; font-size:13px; color:#c7c9cf;">
                  Mail us at <a href="mailto:${supportEmail}" style="color:#fcab79;">${supportEmail}</a>${supportHours}, and we'll help you out.
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
export function renderOtpEmailText(input: OtpEmailInput): string {
  return (
    `Your OTP for ${input.purpose} is ${input.code}\n` +
    `This is valid for ${input.expiresInMinutes} minute${input.expiresInMinutes === 1 ? '' : 's'}.\n\n` +
    `Have questions? Mail us at ${input.supportEmail}${input.supportHours ? ` (${input.supportHours})` : ''}, and we'll help you out.`
  )
}
