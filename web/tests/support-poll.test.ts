// Runs under the repo-root Vitest config (`npx vitest run web/tests`). Kept
// outside web/src so the web app's own tsc/vite builds, which have no test
// runner installed, never pick it up.
import { describe, expect, it } from 'vitest'
import { SUPPORT_POLL_MS, conversationRefetchInterval } from '../src/components/support/poll'

/** The shape `refetchInterval` is handed, narrowed to what the helper reads. */
function queryWithError(error: unknown) {
  return { state: { error } }
}

describe('conversationRefetchInterval', () => {
  it('polls at the thread cadence while the thread is loading fine', () => {
    expect(conversationRefetchInterval(queryWithError(null))).toBe(SUPPORT_POLL_MS.thread)
  })

  // A ticket the viewer can't see, or one that is gone, never becomes
  // readable by waiting: the panel already shows a permanent error, so the
  // timer would just fail every few seconds for as long as the tab is open.
  it.each([403, 404])('stops polling after a permanent %i', (status) => {
    const error = Object.assign(new Error('Not found'), { status })
    expect(conversationRefetchInterval(queryWithError(error))).toBe(false)
  })

  it.each([0, 401, 429, 500, 503])('keeps polling after a recoverable %i', (status) => {
    const error = Object.assign(new Error('Request failed'), { status })
    expect(conversationRefetchInterval(queryWithError(error))).toBe(SUPPORT_POLL_MS.thread)
  })

  it('keeps polling when the failure carries no status at all', () => {
    expect(conversationRefetchInterval(queryWithError(new Error('boom')))).toBe(SUPPORT_POLL_MS.thread)
    expect(conversationRefetchInterval(queryWithError(undefined))).toBe(SUPPORT_POLL_MS.thread)
  })
})
