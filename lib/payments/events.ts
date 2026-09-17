/**
 * Payment lifecycle hooks — the single place side effects (delegate emails,
 * organizer notifications) attach to payment outcomes. Deliberately no-ops
 * for now: the notifications lane wires the real work in here.
 *
 * Contract for callers: invoke only AFTER the transaction that made the
 * change has committed, never inside it, and never let a hook failure
 * affect the response — use `runPaymentHook`.
 */

/** A registration just became CONFIRMED (payment captured, or a free pass). */
export async function onRegistrationConfirmed(registrationId: string): Promise<void> {
  void registrationId
}

/** A payment failed and its registration's seat was released. */
export async function onPaymentFailed(registrationId: string): Promise<void> {
  void registrationId
}

/**
 * Fire-and-forget wrapper: starts `hook` and returns a promise that never
 * rejects (failures are logged). Callers on Workers should hand the returned
 * promise to `executionCtx.waitUntil` so the work isn't cut off when the
 * response is sent.
 */
export function runPaymentHook(
  hook: (registrationId: string) => Promise<void>,
  registrationId: string,
): Promise<void> {
  return Promise.resolve()
    .then(() => hook(registrationId))
    .catch((error: unknown) => {
      console.error(`[payments] ${hook.name || 'payment hook'} failed for registration ${registrationId}`, error)
    })
}
