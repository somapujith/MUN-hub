import { ne, type SQL } from 'drizzle-orm'
import { payments } from '@/lib/db/schema'
import { MOCK_PROVIDER } from './mock-adapter'
import { getPaymentsAdapter } from './registry'

/**
 * Filter for payment rows that stand for real money, for money totals and
 * the payment-exception queue.
 *
 * Mock checkout rows (provider `mock_razorpay`, the column default) moved no
 * money. They count only while the mock adapter is the active one (local dev,
 * tests, E2E), where they are the only payments. Anywhere else they are
 * leftovers, such as mock checkouts completed in production before the mock
 * was switched off, and are left out.
 *
 * Returns `undefined` when nothing needs filtering. `and()` skips undefined.
 * Reads the adapter per call (per request on Workers).
 */
export function countedPaymentsFilter(): SQL | undefined {
  return getPaymentsAdapter()?.provider === MOCK_PROVIDER ? undefined : ne(payments.provider, MOCK_PROVIDER)
}
