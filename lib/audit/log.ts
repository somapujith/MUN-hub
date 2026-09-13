import type { db } from '@/lib/db/client'
import { adminActions } from '@/lib/db/schema'
import type { AdminAction } from '@/lib/db/schema-enums'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Inserts one append-only admin_actions row. Always call this inside the
 * same transaction (`tx`) as the state change it records — never as a
 * separate fire-and-forget write, so a rollback of the change also rolls
 * back its audit row.
 */
export async function recordAdminAction(
  tx: Tx,
  actorId: string,
  action: AdminAction,
  targetType: string,
  targetId: string,
  reason?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(adminActions).values({ actorId, action, targetType, targetId, reason, metadata })
}
