import { afterEach, describe, expect, it, vi } from 'vitest'
import { setRuntimeEnv } from '@/lib/runtime-env'
import { CASHFREE_PROVIDER } from './cashfree-adapter'
import { mockPaymentsAdapter } from './mock-adapter'
import { getPaymentsAdapter } from './registry'

const KEYS = [
  'PAYMENTS_ADAPTER',
  'MOCK_PAYMENTS_ENABLED',
  'MOCK_PAYMENT_WEBHOOK_SECRET',
  'CASHFREE_CLIENT_ID',
  'CASHFREE_CLIENT_SECRET',
  'CASHFREE_ENV',
  'APP_URL',
  'PUBLIC_API_URL',
] as const
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  setRuntimeEnv({})
  vi.restoreAllMocks()
})

describe('getPaymentsAdapter', () => {
  it('returns the mock when it is explicitly enabled', () => {
    process.env.PAYMENTS_ADAPTER = 'mock'
    process.env.MOCK_PAYMENTS_ENABLED = 'true'
    expect(getPaymentsAdapter()).toBe(mockPaymentsAdapter)
  })

  it('defaults to the mock adapter name when PAYMENTS_ADAPTER is unset', () => {
    delete process.env.PAYMENTS_ADAPTER
    process.env.MOCK_PAYMENTS_ENABLED = 'true'
    expect(getPaymentsAdapter()).toBe(mockPaymentsAdapter)
  })

  it('returns null for the mock unless MOCK_PAYMENTS_ENABLED is exactly "true"', () => {
    process.env.PAYMENTS_ADAPTER = 'mock'
    for (const value of [undefined, '', 'false', '1', 'TRUE', 'yes']) {
      if (value === undefined) delete process.env.MOCK_PAYMENTS_ENABLED
      else process.env.MOCK_PAYMENTS_ENABLED = value
      expect(getPaymentsAdapter()).toBeNull()
    }
  })

  it('returns null for the mock when its webhook secret is missing', () => {
    process.env.MOCK_PAYMENTS_ENABLED = 'true'
    delete process.env.MOCK_PAYMENT_WEBHOOK_SECRET
    expect(getPaymentsAdapter()).toBeNull()
  })

  it('returns null for an unknown adapter name', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.PAYMENTS_ADAPTER = 'razorpay'
    process.env.MOCK_PAYMENTS_ENABLED = 'true'
    expect(getPaymentsAdapter()).toBeNull()
  })

  it('reads the Workers-bridged env, not only process.env', () => {
    delete process.env.MOCK_PAYMENTS_ENABLED
    setRuntimeEnv({ MOCK_PAYMENTS_ENABLED: 'true' })
    expect(getPaymentsAdapter()).toBe(mockPaymentsAdapter)
  })

  it('returns a Cashfree adapter when both credentials are present via getRuntimeEnv', () => {
    process.env.PAYMENTS_ADAPTER = 'cashfree'
    setRuntimeEnv({
      CASHFREE_CLIENT_ID: 'test-id',
      CASHFREE_CLIENT_SECRET: 'test-secret',
      APP_URL: 'https://www.munhub.in',
      PUBLIC_API_URL: 'https://api.munhub.in',
    })
    const adapter = getPaymentsAdapter()
    expect(adapter?.provider).toBe(CASHFREE_PROVIDER)
  })

  it('returns null for cashfree when either credential is missing (never falls back to the mock)', () => {
    process.env.PAYMENTS_ADAPTER = 'cashfree'
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'test-id' })
    expect(getPaymentsAdapter()).toBeNull()
    setRuntimeEnv({ CASHFREE_CLIENT_SECRET: 'test-secret' })
    expect(getPaymentsAdapter()).toBeNull()
  })

  it('defaults to production when CASHFREE_ENV is unset, and honors "sandbox" explicitly', () => {
    process.env.PAYMENTS_ADAPTER = 'cashfree'
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' })
    expect(getPaymentsAdapter()?.provider).toBe(CASHFREE_PROVIDER)
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret', CASHFREE_ENV: 'sandbox' })
    expect(getPaymentsAdapter()?.provider).toBe(CASHFREE_PROVIDER)
  })

  it('builds a fresh cashfree adapter instance per call (never cached at module scope)', () => {
    process.env.PAYMENTS_ADAPTER = 'cashfree'
    setRuntimeEnv({ CASHFREE_CLIENT_ID: 'test-id', CASHFREE_CLIENT_SECRET: 'test-secret' })
    const first = getPaymentsAdapter()
    const second = getPaymentsAdapter()
    expect(first).not.toBe(second)
  })
})
