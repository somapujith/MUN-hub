import { lt, or } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { emailLoginCodes, passwordResetTokens, sessions } from '@/lib/db/schema'

/**
 * Housekeeping for sign-in artifacts that are no longer usable, so the auth
 * tables don't grow forever and don't keep credentials-adjacent rows around
 * longer than needed (Privacy Policy retention: sessions expire after 30
 * days, reset links after one hour).
 *
 * - `sessions`: deleted as soon as they expire. `getSessionByToken` already
 *   ignores an expired row, so this changes nothing a user can observe.
 * - `password_reset_tokens`: deleted 7 days after they were used or expired.
 *   The short delay keeps recent reset activity visible when looking into an
 *   account-takeover report.
 * - `email_login_codes` (organizer sign-in codes): deleted 1 day after they
 *   expired, used or not. The per-address hourly resend cap in
 *   lib/actions/organizer-otp.ts only looks at the last hour, so it's
 *   unaffected.
 *
 * Idempotent and safe to run at any frequency. Called by the Worker's
 * scheduled handler (DevOps lane), which must run it inside the same
 * per-request DB scope as a fetch (see lib/db/hyperdrive-bridge.ts).
 */

export const PASSWORD_RESET_TOKEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const LOGIN_CODE_RETENTION_MS = 24 * 60 * 60 * 1000

export interface PurgeAuthArtifactsResult {
  sessions: number
  passwordResetTokens: number
  loginCodes: number
}

export async function purgeExpiredAuthArtifacts(now: Date): Promise<PurgeAuthArtifactsResult> {
  const resetTokenCutoff = new Date(now.getTime() - PASSWORD_RESET_TOKEN_RETENTION_MS)
  const loginCodeCutoff = new Date(now.getTime() - LOGIN_CODE_RETENTION_MS)

  const deletedSessions = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id })

  // `usedAt < cutoff` is null (not true) for an unused token, so an unused
  // token only goes once it has been expired for the full retention window.
  const deletedResetTokens = await db
    .delete(passwordResetTokens)
    .where(or(lt(passwordResetTokens.usedAt, resetTokenCutoff), lt(passwordResetTokens.expiresAt, resetTokenCutoff)))
    .returning({ id: passwordResetTokens.id })

  const deletedLoginCodes = await db
    .delete(emailLoginCodes)
    .where(lt(emailLoginCodes.expiresAt, loginCodeCutoff))
    .returning({ id: emailLoginCodes.id })

  return {
    sessions: deletedSessions.length,
    passwordResetTokens: deletedResetTokens.length,
    loginCodes: deletedLoginCodes.length,
  }
}
