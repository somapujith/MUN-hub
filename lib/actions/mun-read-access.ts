import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { accommodationOptions, committees, muns } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { PUBLIC_DETAIL_STATUSES } from './marketplace'

// -----------------------------------------------------------------------------
// mun-read-access — who may read a MUN's configuration by id
// -----------------------------------------------------------------------------
//
// The by-id module reads (contact, documents, committees/portfolios,
// schedule, media, accommodation, executive board, registration form fields,
// products) are unauthenticated routes, because the public MUN page renders
// the same data. Without a gate they also served every DRAFT/ONBOARDING/
// in-review MUN to anyone who had (or guessed) its id. The rule, applied by
// the route layer before calling the plain list functions:
//
//   - 'owner'  — the owning organizer, ADMIN or SUPER_ADMIN (the same set
//                assertOwnsOrAdmin allows to write), any status.
//   - 'staff'  — OPERATIONS reviewers, any status (Gate 2 review reads
//                unpublished content), but no owner-only side effects.
//   - 'public' — anyone else, only once the MUN is publicly visible
//                (PUBLIC_DETAIL_STATUSES, the same set getMunBySlug uses).
//   - 'none'   — everything else, including an unknown or malformed id.
//                Callers answer 404, never 403, so an unpublished MUN's
//                existence isn't confirmed either.

export type MunReadAccess = 'owner' | 'staff' | 'public' | 'none'

// Ids are text columns (UUID by default), so any string is safe to look up —
// a malformed id simply matches nothing.

/** Resolves how much of `munId` the caller may read. Never throws for a missing or malformed id. */
export async function resolveMunReadAccess(munId: string, session: Session | null): Promise<MunReadAccess> {
  const [mun] = await db
    .select({ organizerId: muns.organizerId, status: muns.status })
    .from(muns)
    .where(eq(muns.id, munId))
    .limit(1)
  if (!mun) return 'none'

  if (session) {
    if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN' || mun.organizerId === session.userId) {
      return 'owner'
    }
    if (session.role === 'OPERATIONS') return 'staff'
  }

  return PUBLIC_DETAIL_STATUSES.includes(mun.status) ? 'public' : 'none'
}

/**
 * Throws `Error('Mun not found')` (mapped to 404) unless the caller may read
 * `munId`; otherwise returns the access level so the caller can decide how
 * much to show (e.g. contact-person details are owner/staff only).
 */
export async function assertMunReadable(
  munId: string,
  session: Session | null,
): Promise<Exclude<MunReadAccess, 'none'>> {
  const access = await resolveMunReadAccess(munId, session)
  if (access === 'none') throw new Error('Mun not found')
  return access
}

/** The MUN a committee belongs to, or null for an unknown/malformed id. */
export async function findMunIdForCommittee(committeeId: string): Promise<string | null> {
  const [row] = await db
    .select({ munId: committees.munId })
    .from(committees)
    .where(eq(committees.id, committeeId))
    .limit(1)
  return row?.munId ?? null
}

/** The MUN an accommodation option belongs to, or null for an unknown/malformed id. */
export async function findMunIdForAccommodationOption(optionId: string): Promise<string | null> {
  const [row] = await db
    .select({ munId: accommodationOptions.munId })
    .from(accommodationOptions)
    .where(eq(accommodationOptions.id, optionId))
    .limit(1)
  return row?.munId ?? null
}
