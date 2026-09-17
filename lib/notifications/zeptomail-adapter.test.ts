import { afterEach, describe, expect, it } from 'vitest'
import { zeptoMailNotificationsAdapter } from './zeptomail-adapter'

const ORIGINAL_TOKEN = process.env.ZEPTOMAIL_TOKEN
const ORIGINAL_FROM = process.env.ZEPTOMAIL_FROM_ADDRESS

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.ZEPTOMAIL_TOKEN
  else process.env.ZEPTOMAIL_TOKEN = ORIGINAL_TOKEN
  if (ORIGINAL_FROM === undefined) delete process.env.ZEPTOMAIL_FROM_ADDRESS
  else process.env.ZEPTOMAIL_FROM_ADDRESS = ORIGINAL_FROM
})

describe('zeptoMailNotificationsAdapter', () => {
  it('throws without ever reaching the network when ZEPTOMAIL_TOKEN is unset', async () => {
    delete process.env.ZEPTOMAIL_TOKEN
    process.env.ZEPTOMAIL_FROM_ADDRESS = 'noreply@example.com'

    await expect(
      zeptoMailNotificationsAdapter.send({ to: 'user@example.com', subject: 'x', body: 'y' }),
    ).rejects.toThrow('ZEPTOMAIL_TOKEN')
  })

  it('throws without ever reaching the network when ZEPTOMAIL_FROM_ADDRESS is unset', async () => {
    process.env.ZEPTOMAIL_TOKEN = 'test-token'
    delete process.env.ZEPTOMAIL_FROM_ADDRESS

    await expect(
      zeptoMailNotificationsAdapter.send({ to: 'user@example.com', subject: 'x', body: 'y' }),
    ).rejects.toThrow('ZEPTOMAIL_FROM_ADDRESS')
  })
})
