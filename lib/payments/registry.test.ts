import { afterEach, describe, expect, it, vi } from 'vitest'
import { setRuntimeEnv } from '@/lib/runtime-env'
import { GURUPAY_PROVIDER } from './gurupay-adapter'
import { mockPaymentsAdapter } from './mock-adapter'
import { getPaymentsAdapter } from './registry'

const KEYS = [
  'PAYMENTS_ADAPTER',
  'MOCK_PAYMENTS_ENABLED',
  'MOCK_PAYMENT_WEBHOOK_SECRET',
  'GURUPAY_API_KEY',
  'APP_URL',
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

  it('returns a GuruPay adapter when GURUPAY_API_KEY is present via getRuntimeEnv', () => {
    process.env.PAYMENTS_ADAPTER = 'gurupay'
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key', APP_URL: 'https://www.munhub.in' })
    const adapter = getPaymentsAdapter()
    expect(adapter?.provider).toBe(GURUPAY_PROVIDER)
  })

  it('returns null for gurupay when GURUPAY_API_KEY is missing (never falls back to the mock)', () => {
    process.env.PAYMENTS_ADAPTER = 'gurupay'
    delete process.env.GURUPAY_API_KEY
    setRuntimeEnv({})
    expect(getPaymentsAdapter()).toBeNull()
  })

  it('builds a fresh gurupay adapter instance per call (never cached at module scope)', () => {
    process.env.PAYMENTS_ADAPTER = 'gurupay'
    setRuntimeEnv({ GURUPAY_API_KEY: 'test-key' })
    const first = getPaymentsAdapter()
    const second = getPaymentsAdapter()
    expect(first).not.toBe(second)
  })
})
