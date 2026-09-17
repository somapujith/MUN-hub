import { db } from '@/lib/db/client'
import { recordAdminAction } from '@/lib/audit/log'

// -----------------------------------------------------------------------------
// Staff reads of delegate personal data (names, emails) are audited as
// admin_actions rows with action PII_READ (migration 0035), one row per read:
//
// - a read that returned one record: targetType = that record's type,
//   targetId = its id, so the row shows up in that record's audit trail;
// - a read that returned several: targetType = `<type>_list`, targetId = the
//   route pattern, and the ids are in `metadata.targetIds`.
//
// A read that returned no records discloses nothing and writes nothing. The
// search text itself is never recorded (it is often a name or an email);
// only whether one was given. Recording never fails the read: if the insert
// fails, the same facts go to the error log instead.
// -----------------------------------------------------------------------------

export interface PiiReadEvent {
  actorId: string
  /** Route pattern, e.g. `GET /admin/registrations` — never the raw URL (it carries the search text). */
  route: string
  /** Type of the records whose personal data was returned, e.g. `registration`. */
  targetType: string
  /** Ids of the records whose personal data was returned. */
  targetIds: string[]
  hasQuery: boolean
}

export interface PiiReadRecord {
  actorId: string
  targetType: string
  targetId: string
  metadata: {
    route: string
    recordType: string
    targetIds: string[]
    count: number
    hasQuery: boolean
  }
}

/** The admin_actions row a read is recorded as, or null when the read returned nothing. */
export function toPiiReadRecord(event: PiiReadEvent): PiiReadRecord | null {
  if (event.targetIds.length === 0) return null
  const single = event.targetIds.length === 1
  return {
    actorId: event.actorId,
    targetType: single ? event.targetType : `${event.targetType}_list`,
    targetId: single ? event.targetIds[0] : event.route,
    metadata: {
      route: event.route,
      recordType: event.targetType,
      targetIds: event.targetIds,
      count: event.targetIds.length,
      hasQuery: event.hasQuery,
    },
  }
}

/**
 * Records a staff read of delegate personal data (see the header). Awaited by
 * the route before it responds, so the audit row exists before the data
 * leaves. Never throws.
 */
export async function recordPiiRead(event: PiiReadEvent): Promise<PiiReadRecord | null> {
  const record = toPiiReadRecord(event)
  if (!record) return null
  try {
    await recordAdminAction(db, record.actorId, 'PII_READ', record.targetType, record.targetId, undefined, record.metadata)
  } catch (error) {
    try {
      console.error(
        JSON.stringify({
          event: 'pii_read.audit_failed',
          actorId: record.actorId,
          targetType: record.targetType,
          targetId: record.targetId,
          ...record.metadata,
          at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    } catch {
      // Logging must never fail the read it describes.
    }
  }
  return record
}
