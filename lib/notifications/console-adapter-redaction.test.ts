import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { isProductionRuntime, isWorkersRuntime } from '@/lib/runtime-platform'
import { consoleNotificationsAdapter } from './console-adapter'

const RESET_LINK = 'https://munhub.in/reset-password?token=0123456789abcdef'
const NOTIFICATION = {
  to: 'delegate@example.com',
  subject: 'Reset your MUN Hub password',
  body: `Your sign-in code is 482913. Or use ${RESET_LINK}`,
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV
let logSpy: MockInstance<typeof console.log>

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  vi.unstubAllGlobals()
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV
})

function logged(): string {
  return logSpy.mock.calls.map((args) => args.join(' ')).join('\n')
}

describe('runtime platform detection', () => {
  it('recognises Workers by its navigator user agent', () => {
    expect(isWorkersRuntime()).toBe(false)
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
    expect(isWorkersRuntime()).toBe(true)
    expect(isProductionRuntime()).toBe(true)
  })

  it('treats NODE_ENV=production as production off Workers', () => {
    process.env.NODE_ENV = 'development'
    expect(isProductionRuntime()).toBe(false)
    process.env.NODE_ENV = 'production'
    expect(isProductionRuntime()).toBe(true)
  })
})

describe('consoleNotificationsAdapter', () => {
  it('prints the full message in local development', async () => {
    process.env.NODE_ENV = 'development'
    await consoleNotificationsAdapter.send(NOTIFICATION)

    expect(logged()).toContain('482913')
    expect(logged()).toContain(RESET_LINK)
    expect(logged()).toContain('delegate@example.com')
  })

  it('never prints codes, links or the full address with NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production'
    await consoleNotificationsAdapter.send(NOTIFICATION)

    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logged()).not.toContain('482913')
    expect(logged()).not.toContain('token=')
    expect(logged()).not.toContain('delegate@example.com')
    expect(logged()).toContain('d***@example.com')
    expect(logged()).toContain('body redacted')
  })

  it('redacts on Workers even when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development'
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
    await consoleNotificationsAdapter.send(NOTIFICATION)

    expect(logged()).not.toContain('482913')
    expect(logged()).not.toContain(RESET_LINK)
  })
})
