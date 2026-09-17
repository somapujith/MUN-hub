import { getRuntimeEnv } from '@/lib/runtime-env'
import type { PaymentsAdapter } from './adapter'
import { getMockWebhookSecret, mockPaymentsAdapter } from './mock-adapter'

/**
 * Picks the payments adapter for the current request from
 * `PAYMENTS_ADAPTER` (default 'mock'). Returns `null` when no usable adapter
 * is configured — callers must treat that as "online payments are
 * unavailable" (paid registrations refused with PAYMENTS_UNAVAILABLE, mock
 * checkout hidden), never fall back to the mock.
 *
 * The mock is usable only when `MOCK_PAYMENTS_ENABLED` is exactly 'true'
 * (and its webhook secret is set): it confirms registrations without real
 * money, so production must never have that flag.
 *
 * Read per call via getRuntimeEnv — Workers bind vars per request, and
 * nothing here may be cached at module scope.
 *
 * Adding a provider: implement `PaymentsAdapter` in its own file and add a
 * case below that returns it only when its credentials are present. See
 * docs/payments/INTEGRATION.md.
 */
export function getPaymentsAdapter(): PaymentsAdapter | null {
  const name = (getRuntimeEnv('PAYMENTS_ADAPTER') || 'mock').trim().toLowerCase()

  switch (name) {
    case 'mock':
      return getRuntimeEnv('MOCK_PAYMENTS_ENABLED') === 'true' && getMockWebhookSecret()
        ? mockPaymentsAdapter
        : null
    default:
      console.error(`[payments] unknown PAYMENTS_ADAPTER "${name}" — online payments are unavailable`)
      return null
  }
}
