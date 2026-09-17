import { afterEach, describe, expect, it } from 'vitest'
import { getNotificationsAdapter } from './select-adapter'
import { consoleNotificationsAdapter } from './console-adapter'
import { zeptoMailNotificationsAdapter } from './zeptomail-adapter'

const ORIGINAL_TOKEN = process.env.ZEPTOMAIL_TOKEN

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.ZEPTOMAIL_TOKEN
  else process.env.ZEPTOMAIL_TOKEN = ORIGINAL_TOKEN
})

describe('getNotificationsAdapter', () => {
  it('falls back to the console adapter when ZEPTOMAIL_TOKEN is unset', () => {
    delete process.env.ZEPTOMAIL_TOKEN
    expect(getNotificationsAdapter()).toBe(consoleNotificationsAdapter)
  })

  it('selects the ZeptoMail adapter once ZEPTOMAIL_TOKEN is set', () => {
    process.env.ZEPTOMAIL_TOKEN = 'test-token'
    expect(getNotificationsAdapter()).toBe(zeptoMailNotificationsAdapter)
  })
})
