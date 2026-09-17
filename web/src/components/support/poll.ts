/**
 * Support polling cadences and the one rule that turns a poll off. Kept free
 * of React and of the API modules so it can be unit-tested under Node; the
 * hooks in `use-support.ts` re-export it, so callers import either one.
 */

/**
 * Polling cadence. Every support query polls only while it is mounted and
 * enabled (the widget is open, a thread is selected) and only while the tab is
 * visible — TanStack Query pauses `refetchInterval` for hidden tabs when
 * `refetchIntervalInBackground` is false, and refetches on focus instead.
 */
export const SUPPORT_POLL_MS = {
  /** The widget badge, while the widget is closed. */
  badge: 60_000,
  /** A conversation list that is on screen. */
  list: 15_000,
  /** The open thread. */
  thread: 5_000,
  /** The staff queue. */
  staffQueue: 30_000,
} as const;

/**
 * How long to wait before polling the open thread again, or `false` to stop.
 *
 * A 403 or a 404 never recovers on its own — the viewer can't see this ticket
 * (a deep link from `?ticket=`, or a support email about someone else's), or
 * it is gone. The shared query client doesn't retry below 500, so the thread
 * settles on a permanent "isn't available" error while the interval timer
 * would keep firing a failing request every few seconds for as long as the tab
 * stays open. An explicit retry still refetches, and a success clears the
 * error and resumes polling.
 */
export function conversationRefetchInterval(query: { state: { error: unknown } }): number | false {
  const status = (query.state.error as { status?: number } | null | undefined)?.status;
  return status === 403 || status === 404 ? false : SUPPORT_POLL_MS.thread;
}
