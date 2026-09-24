import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adminActions, users, verificationLogs } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import { requireRole } from '@/lib/auth/authorize'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

export interface AuditEntry {
  action: string
  actorId: string
  /** Resolved from `users.name` — same join pattern `listAdminActions` (admin-audit.ts) uses for its list feed. */
  actorName: string
  reason: string | null
  createdAt: Date
}

/**
 * Merges `admin_actions` (general admin audit log) and `verification_logs`
 * (mun lifecycle transitions) for one target, sorted oldest-first. Only
 * targetType 'mun' has verification_logs entries — every other target type
 * returns admin_actions rows only. Requires OPERATIONS/ADMIN/SUPER_ADMIN,
 * same as every other admin-facing read in this codebase.
 */
export async function getAuditHistory(
  targetType: string,
  targetId: string,
  session: Session | null,
): Promise<AuditEntry[]> {
  requireRole(session, [...ADMIN_ROLES])

  const generalActions = await db
    .select({
      // `metadata.event`, when present, names the precise event behind the
      // stored enum value (see lib/actions/admin-staff.ts).
      action: sql<string>`coalesce(${adminActions.metadata}->>'event', ${adminActions.action}::text)`,
      actorId: adminActions.actorId,
      actorName: users.name,
      reason: adminActions.reason,
      createdAt: adminActions.createdAt,
    })
    .from(adminActions)
    .innerJoin(users, eq(users.id, adminActions.actorId))
    .where(and(eq(adminActions.targetType, targetType), eq(adminActions.targetId, targetId)))

  const lifecycleActions =
    targetType === 'mun'
      ? await db
          .select({
            action: verificationLogs.action,
            actorId: verificationLogs.reviewerId,
            actorName: users.name,
            reason: verificationLogs.notes,
            createdAt: verificationLogs.createdAt,
          })
          .from(verificationLogs)
          .innerJoin(users, eq(users.id, verificationLogs.reviewerId))
          .where(eq(verificationLogs.munId, targetId))
      : []

  return [...generalActions, ...lifecycleActions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )
}
