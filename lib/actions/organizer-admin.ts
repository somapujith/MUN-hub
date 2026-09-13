'use server'

import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { getSession } from '@/lib/auth/session'
import { requireRole } from '@/lib/auth/authorize'
import { recordAdminAction } from '@/lib/audit/log'
import type { User } from '@/lib/types'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export type OrganizerRow = Pick<
  User,
  'id' | 'name' | 'email' | 'suspended' | 'suspendedReason' | 'suspendedAt'
>

export interface ListOrganizersParams {
  limit?: number
  offset?: number
}

export interface ListOrganizersResult {
  results: OrganizerRow[]
  total: number
}

/**
 * Paginated list of organizer accounts (role = ORGANIZER only), for the
 * admin organizer-management console. Requires OPERATIONS/ADMIN/SUPER_ADMIN
 * — actor is derived from `getSession()`, never accepted as a parameter.
 *
 * Same pagination reasoning as `getReviewQueue`/`getModuleReviewQueue`
 * (lib/actions/admin-review.ts): this grows with total organizer count, not
 * per-mun, so it needs a bound before real platform volume.
 */
export async function listOrganizers(params: ListOrganizersParams = {}): Promise<ListOrganizersResult> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const whereClause = eq(users.role, 'ORGANIZER')

  const results = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      suspended: users.suspended,
      suspendedReason: users.suspendedReason,
      suspendedAt: users.suspendedAt,
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

/**
 * Blocks an organizer's login (`getSession`/`signIn` already reject
 * suspended users — see lib/auth/session.ts and lib/actions/auth.ts).
 * Deliberately does NOT cascade to the organizer's MUNs: a suspension is an
 * account-level login block, not a content takedown — an admin unpublishes
 * or suspends a specific MUN separately if the content itself is the
 * problem. Requires OPERATIONS/ADMIN/SUPER_ADMIN.
 */
export async function suspendOrganizer(userId: string, reason: string): Promise<void> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ suspended: true, suspendedReason: reason, suspendedAt: new Date() })
      .where(eq(users.id, userId))

    await recordAdminAction(tx, session.userId, 'ORGANIZER_SUSPENDED', 'user', userId, reason)
  })
}

/**
 * Clears a suspension, restoring the organizer's login access. Requires
 * OPERATIONS/ADMIN/SUPER_ADMIN.
 */
export async function reinstateOrganizer(userId: string): Promise<void> {
  const session = await getSession()
  requireRole(session, [...ADMIN_ROLES])

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ suspended: false, suspendedReason: null, suspendedAt: null })
      .where(eq(users.id, userId))

    await recordAdminAction(tx, session.userId, 'ORGANIZER_REINSTATED', 'user', userId)
  })
}
