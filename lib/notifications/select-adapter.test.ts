import { afterEach, describe, expect, it } from 'vitest'
import { getNotificationsAdapter } from './select-adapter'
import { consoleNotificationsAdapter } from './console-adapter'
import { zeptoMailNotificationsAdapter } from './zeptomail-adapter'

const ORIGINAL_TOKEN = process.env.ZEPTOMAIL_TOKEN
const ORIGINAL_NODE_ENV = process.env.NODE_ENV

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.ZEPTOMAIL_TOKEN
  else process.env.ZEPTOMAIL_TOKEN = ORIGINAL_TOKEN
  process.env.NODE_ENV = ORIGINAL_NODE_ENV
})

describe('getNotificationsAdapter', () => {
  it('falls back to the console adapter when ZEPTOMAIL_TOKEN is unset (non-production)', () => {
    delete process.env.ZEPTOMAIL_TOKEN
    expect(getNotificationsAdapter()).toBe(consoleNotificationsAdapter)
  })

  it('selects the ZeptoMail adapter once ZEPTOMAIL_TOKEN is set', () => {
    process.env.ZEPTOMAIL_TOKEN = 'test-token'
    expect(getNotificationsAdapter()).toBe(zeptoMailNotificationsAdapter)
  })

  it('still selects ZeptoMail in production when ZEPTOMAIL_TOKEN is set', () => {
    process.env.ZEPTOMAIL_TOKEN = 'test-token'
    process.env.NODE_ENV = 'production'
    expect(getNotificationsAdapter()).toBe(zeptoMailNotificationsAdapter)
  })

  // Regression: this used to throw. Wrangler statically replaces
  // process.env.NODE_ENV with 'production' in EVERY deployed bundle, staging
  // included, so the throw broke the documented no-token staging deploy
  // (organizer sign-in codes 503'd, every cron run reported a failure). The
  // OTP/reset-link leak it guarded against is closed inside the console
  // adapter itself, which redacts bodies whenever isProductionRuntime() —
  // see console-adapter-redaction.test.ts.
  it('falls back to the (redacting) console adapter in production without ZEPTOMAIL_TOKEN', () => {
    delete process.env.ZEPTOMAIL_TOKEN
    process.env.NODE_ENV = 'production'
    expect(getNotificationsAdapter()).toBe(consoleNotificationsAdapter)
  })
})
