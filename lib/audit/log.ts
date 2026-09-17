import type { db } from '@/lib/db/client'
import { adminActions } from '@/lib/db/schema'
import type { AdminAction } from '@/lib/db/schema-enums'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Inserts one append-only admin_actions row. When the row records a state
 * change, pass the same transaction (`tx`) as the change — never a separate
 * fire-and-forget write — so a rollback of the change also rolls back its
 * audit row. A row that records a read (lib/actions/admin-pii-read.ts) has no
 * change to join and may pass `db` itself.
 */
export async function recordAdminAction(
  tx: Tx | typeof db,
  actorId: string,
  action: AdminAction,
  targetType: string,
  targetId: string,
  reason?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(adminActions).values({ actorId, action, targetType, targetId, reason, metadata })
}
