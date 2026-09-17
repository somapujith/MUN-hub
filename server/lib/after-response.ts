import type { Context } from 'hono'

/**
 * Runs `work` without the response waiting on it, for handlers whose answer
 * must not depend on what the work does or how long it takes.
 *
 * Both callers are "always 204, never say whether that address has an
 * account" endpoints (password-reset request, verification resend). Awaiting
 * them inline leaks exactly what the generic response hides: a registered
 * address costs a database write plus an outbound mail-provider call, an
 * unknown one costs a single indexed lookup, and the difference is plainly
 * visible in response time.
 *
 * On Workers `c.executionCtx.waitUntil` keeps the isolate (and the request's
 * I/O objects — see CLAUDE.md on Workers request isolation) alive until the
 * work settles, so it really does run after the response. Off Workers there
 * is no ExecutionContext — local Node dev, and Hono's `app.request()` test
 * helper — and the work is awaited instead: the timing signal only matters
 * against the public deployment, which is Workers, and awaiting keeps
 * behavior deterministic for tests and for a dev server that would otherwise
 * exit mid-send.
 *
 * Failures are logged, never rethrown: the response has already been decided.
 */
export async function runAfterResponse(c: Context, work: Promise<void>, label: string): Promise<void> {
  const guarded = work.catch((error: unknown) => {
    console.error(`[${label}] deferred work failed`, { error })
  })

  try {
    c.executionCtx.waitUntil(guarded)
    return
  } catch {
    // Hono's executionCtx getter throws when there is no ExecutionContext.
  }

  await guarded
}
