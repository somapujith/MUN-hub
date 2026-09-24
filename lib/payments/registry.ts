import { getRuntimeEnv } from '@/lib/runtime-env'
import type { PaymentsAdapter } from './adapter'
import { createCashfreeAdapter } from './cashfree-adapter'
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
 * docs/payments/CASHFREE.md.
 */
export function getPaymentsAdapter(): PaymentsAdapter | null {
  const name = (getRuntimeEnv('PAYMENTS_ADAPTER') || 'mock').trim().toLowerCase()

  switch (name) {
    case 'mock':
      return getRuntimeEnv('MOCK_PAYMENTS_ENABLED') === 'true' && getMockWebhookSecret()
        ? mockPaymentsAdapter
        : null
    case 'cashfree': {
      const clientId = getRuntimeEnv('CASHFREE_CLIENT_ID')
      const clientSecret = getRuntimeEnv('CASHFREE_CLIENT_SECRET')
      if (!clientId || !clientSecret) return null
      const env = getRuntimeEnv('CASHFREE_ENV') === 'sandbox' ? 'sandbox' : 'production'
      // notifyUrl is Cashfree's per-order webhook target (order_meta.notify_url
      // on every createOrder call) — there is no dashboard-level webhook
      // setting to configure separately, unlike some other gateways.
      // PUBLIC_API_URL is this API's own public origin (production:
      // https://api.munhub.in) — the same var lib/storage/* already uses for
      // API-facing URLs.
      const apiOrigin = (getRuntimeEnv('PUBLIC_API_URL') || 'http://localhost:3001').replace(/\/$/, '')
      // APP_URL is the web app's own origin (production: https://www.munhub.in)
      // — the same var lib/notifications/* already uses for web-facing links.
      // Every real call from lib/actions/registration.ts supplies its own
      // per-registration `CreateOrderInput.returnUrl`; this is only the
      // adapter-level fallback if one is ever missing.
      const webOrigin = (getRuntimeEnv('APP_URL') || 'http://localhost:5173').replace(/\/$/, '')
      return createCashfreeAdapter({
        clientId,
        clientSecret,
        env,
        notifyUrl: `${apiOrigin}/webhooks/payments`,
        appUrl: webOrigin,
      })
    }
    default:
      console.error(`[payments] unknown PAYMENTS_ADAPTER "${name}" — online payments are unavailable`)
      return null
  }
}
