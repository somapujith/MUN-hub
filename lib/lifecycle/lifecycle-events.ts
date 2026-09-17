// -----------------------------------------------------------------------------
// Conference lifecycle events — notification seam
// -----------------------------------------------------------------------------
//
// lib/lifecycle/registration-lifecycle.ts calls these hooks AFTER the
// triggering status change has committed, never inside its transaction, so a
// delivery failure can never roll back (or block) the lifecycle change
// itself. The caller also wraps each call in its own try/catch and logs, so
// an implementation here may throw without surfacing as an API error.
//
// The hooks are awaited by the caller (not fire-and-forget): on Cloudflare
// Workers, work still pending after the response is returned can be dropped
// unless it is handed to `waitUntil`, so an un-awaited send would silently
// never happen in production. If delegate fan-out ever gets slow enough to
// matter, move it onto a queue here rather than un-awaiting the call site.
//
// Owned by the notifications lane from here on: these are deliberately
// no-ops until that lane wires real recipients and templates.
// -----------------------------------------------------------------------------

/**
 * A MUN moved to CANCELLED (organizer or admin action — the reason is on the
 * latest `verification_logs` row for the mun with `action = 'CANCELLED'`).
 * Intended recipients: every delegate holding a CONFIRMED registration, and
 * the organizer when an admin cancelled. There are no refunds in MUN Hub —
 * the message must not promise one.
 */
export async function notifyConferenceCancelled(munId: string): Promise<void> {
  void munId
}
