import { and, eq, ilike, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'
import { recordAdminAction } from '@/lib/audit/log'
import type { User } from '@/lib/types'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export type OrganizerRow = Pick<
  User,
  'id' | 'name' | 'email' | 'institution' | 'suspended' | 'suspendedReason' | 'suspendedAt' | 'createdAt'
>

export interface ListOrganizersParams {
  limit?: number
  offset?: number
  // Case-insensitive substring match against name OR email. Added
  // 2026-09-17 — this was previously a documented gap (see
  // organizer-admin.test.ts's `listOrganizers` describe block); the admin
  // organizer directory page needs it to be usable once seed/real data
  // volume grows past a single page.
  search?: string
}

export interface ListOrganizersResult {
  results: OrganizerRow[]
  total: number
}

/**
 * Paginated list of organizer accounts (role = ORGANIZER only), for the
 * admin organizer-management console. Requires OPERATIONS/ADMIN/SUPER_ADMIN
 * — actor is derived from the caller-supplied `session`, never accepted as
 * a client-trusted value.
 *
 * Same pagination reasoning as `getReviewQueue`/`getModuleReviewQueue`
 * (lib/actions/admin-review.ts): this grows with total organizer count, not
 * per-mun, so it needs a bound before real platform volume.
 */
export async function listOrganizers(
  params: ListOrganizersParams = {},
  session: Session | null,
): Promise<ListOrganizersResult> {
  requireRole(session, [...ADMIN_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const trimmedSearch = params.search?.trim()
  const whereClause = trimmedSearch
    ? and(
        eq(users.role, 'ORGANIZER'),
        or(ilike(users.name, `%${trimmedSearch}%`), ilike(users.email, `%${trimmedSearch}%`)),
      )
    : eq(users.role, 'ORGANIZER')

  const results = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      institution: users.institution,
      suspended: users.suspended,
      suspendedReason: users.suspendedReason,
      suspendedAt: users.suspendedAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(whereClause)
    .orderBy(users.name)
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(whereClause)

  return { results, total: count }
}

/** Thrown when the target id is not an ORGANIZER account (the API maps it to 404). */
export const ORGANIZER_NOT_FOUND = 'Organizer not found'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Row-locks the target user inside `tx` and throws `ORGANIZER_NOT_FOUND`
 * unless it exists AND has role ORGANIZER. Suspend/reinstate here are open to
 * OPERATIONS, so without this check an OPERATIONS account could suspend (or
 * reinstate) an ADMIN/SUPER_ADMIN just by passing that user's id. Staff
 * accounts are managed only through lib/actions/admin-staff.ts, which is
 * SUPER_ADMIN-only. A non-organizer id reads as "not found", not "forbidden",
 * so this endpoint can't be used to probe which ids belong to staff.
 */
async function lockOrganizer(tx: Tx, userId: string): Promise<void> {
  const [target] = await tx
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
    .limit(1)
  if (!target || target.role !== 'ORGANIZER') {
    throw new Error(ORGANIZER_NOT_FOUND)
  }
}

/**
 * Blocks an organizer's login (`getSession`/`signIn` already reject
 * suspended users — see lib/auth/session.ts and lib/actions/auth.ts).
 * Deliberately does NOT cascade to the organizer's MUNs: a suspension is an
 * account-level login block, not a content takedown — an admin unpublishes
 * or suspends a specific MUN separately if the content itself is the
 * problem. Requires OPERATIONS/ADMIN/SUPER_ADMIN, and only ever acts on an
 * ORGANIZER account (see `lockOrganizer`).
 */
export async function suspendOrganizer(userId: string, reason: string, session: Session | null): Promise<void> {
  requireRole(session, [...ADMIN_ROLES])

  await db.transaction(async (tx) => {
    await lockOrganizer(tx, userId)

    await tx
      .update(users)
      .set({ suspended: true, suspendedReason: reason, suspendedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.role, 'ORGANIZER')))

    await recordAdminAction(tx, session.userId, 'ORGANIZER_SUSPENDED', 'user', userId, reason)
  })
}

/**
 * Clears a suspension, restoring the organizer's login access. Requires
 * OPERATIONS/ADMIN/SUPER_ADMIN, and only ever acts on an ORGANIZER account
 * (see `lockOrganizer`) — a suspended staff account is reinstated through
 * lib/actions/admin-staff.ts instead.
 */
export async function reinstateOrganizer(userId: string, session: Session | null): Promise<void> {
  requireRole(session, [...ADMIN_ROLES])

  await db.transaction(async (tx) => {
    await lockOrganizer(tx, userId)

    await tx
      .update(users)
      .set({ suspended: false, suspendedReason: null, suspendedAt: null })
      .where(and(eq(users.id, userId), eq(users.role, 'ORGANIZER')))

    await recordAdminAction(tx, session.userId, 'ORGANIZER_REINSTATED', 'user', userId)
  })
}
