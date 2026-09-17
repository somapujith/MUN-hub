// -----------------------------------------------------------------------------
// Staff reads of delegate personal data (names, emails) are logged. The
// admin_actions enum has no read-access value, and appending a row per read
// would need a migration plus a write on every list page load, so for now each
// read emits one structured log line that Workers Logs / `wrangler tail` can
// filter on `event = "pii_read"`. A dedicated audit enum value is a follow-up.
//
// The search text itself is never logged (it is often a name or an email);
// only whether one was given.
// -----------------------------------------------------------------------------

export interface PiiReadEvent {
  actorId: string
  /** Route pattern, e.g. `GET /admin/registrations` — never the raw URL (it carries the search text). */
  route: string
  targetType: string
  /** Ids of the records whose personal data was returned. */
  targetIds: string[]
  hasQuery: boolean
}

export interface PiiReadLogLine {
  event: 'pii_read'
  actorId: string
  route: string
  targetType: string
  /** The single record read, or null for a list read (see `targetIds`). */
  targetId: string | null
  targetIds: string[]
  count: number
  hasQuery: boolean
  at: string
}

/** Emits the `pii_read` log line and returns it (for tests). Never throws. */
export function recordPiiRead(event: PiiReadEvent, now: Date = new Date()): PiiReadLogLine {
  const line: PiiReadLogLine = {
    event: 'pii_read',
    actorId: event.actorId,
    route: event.route,
    targetType: event.targetType,
    targetId: event.targetIds.length === 1 ? event.targetIds[0] : null,
    targetIds: event.targetIds,
    count: event.targetIds.length,
    hasQuery: event.hasQuery,
    at: now.toISOString(),
  }
  try {
    console.info(JSON.stringify(line))
  } catch {
    // Logging must never fail the read it describes.
  }
  return line
}
