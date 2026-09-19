import { and, desc, eq } from 'drizzle-orm'
import type { Session } from '@/lib/auth/adapter'
import { db } from '@/lib/db/client'
import { achievements, certificates, muns } from '@/lib/db/schema'

// -----------------------------------------------------------------------------
// Delegate-facing certificates and achievements
// -----------------------------------------------------------------------------
//
// The delegate's own view of the two "verified record" tables. Organizers see
// the same rows from the other side (`certificates.ts#listCertificates`,
// `results.ts#listMunAchievements`); this is the read a delegate gets of their
// OWN rows.
//
// Trust rules:
//   - The acting user always comes from `session` — never a `userId` argument
//     (IDOR), same as `student-dashboard.ts`.
//   - An award only shows once MUN Hub has verified it. Awards are typed in by
//     the organizer and stay `unverified` until staff approve the MUN's
//     results (`results.ts#reviewResults` flips them to `verified`), so a
//     delegate never sees an award that could still be edited or returned.
//   - Certificates show as soon as a row exists, with their verification state
//     alongside — the file itself is the organizer's, and the delegate is the
//     person it was issued to.
//   - Nothing here creates a certificate. Issuing them is still an organizer-
//     side feature that doesn't exist yet, so this list is empty until it does.

export interface MyAchievement {
  id: string
  munId: string
  munName: string
  city: string | null
  munStartDate: Date | null
  munEndDate: Date | null
  committee: string | null
  portfolio: string | null
  award: string | null
  awardedAt: Date
}

export interface MyCertificate {
  id: string
  munId: string
  munName: string
  city: string | null
  munStartDate: Date | null
  munEndDate: Date | null
  /** An absolute http(s) link to the file, or null when there is nothing to download (yet). */
  downloadUrl: string | null
  /** MUN Hub has verified this certificate. */
  verified: boolean
  issuedAt: Date
}

export interface MyCredentials {
  achievements: MyAchievement[]
  certificates: MyCertificate[]
}

/**
 * `certificate_url` is free text written by whatever issues the certificate, so
 * only pass on a real web link — never a `javascript:`/`data:` URL the page
 * would then render as a clickable href.
 */
function toDownloadUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * The signed-in delegate's verified awards and their certificates, newest
 * first. Throws `Forbidden` when unauthenticated.
 */
export async function listMyCredentials(session: Session | null): Promise<MyCredentials> {
  if (!session) throw new Error('Forbidden')

  const [awardRows, certificateRows] = await Promise.all([
    db
      .select({
        id: achievements.id,
        munId: achievements.munId,
        munName: muns.name,
        city: muns.city,
        munStartDate: muns.startDate,
        munEndDate: muns.endDate,
        committee: achievements.committee,
        portfolio: achievements.portfolio,
        award: achievements.award,
        awardedAt: achievements.createdAt,
      })
      .from(achievements)
      .innerJoin(muns, eq(muns.id, achievements.munId))
      .where(and(eq(achievements.userId, session.userId), eq(achievements.verificationStatus, 'verified')))
      .orderBy(desc(achievements.createdAt), desc(achievements.id)),
    db
      .select({
        id: certificates.id,
        munId: certificates.munId,
        munName: muns.name,
        city: muns.city,
        munStartDate: muns.startDate,
        munEndDate: muns.endDate,
        certificateUrl: certificates.certificateUrl,
        verificationStatus: certificates.verificationStatus,
        issuedAt: certificates.createdAt,
      })
      .from(certificates)
      .innerJoin(muns, eq(muns.id, certificates.munId))
      .where(eq(certificates.userId, session.userId))
      .orderBy(desc(certificates.createdAt), desc(certificates.id)),
  ])

  return {
    achievements: awardRows,
    certificates: certificateRows.map(({ certificateUrl, verificationStatus, ...rest }) => ({
      ...rest,
      downloadUrl: toDownloadUrl(certificateUrl),
      verified: verificationStatus === 'verified',
    })),
  }
}
