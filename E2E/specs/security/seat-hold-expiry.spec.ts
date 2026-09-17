import { expect, test } from '@playwright/test'
import { newApiContext, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { OPEN } from '../../fixtures/fixture-muns'
import { emailsTo, expectNoEmail, waitForEmail } from '../../fixtures/outbox'
import { registerForPass } from '../../fixtures/payments'
import { expireSeatHold, registrationStatus } from '../../fixtures/payments-fixture-db'

/**
 * The releaseExpiredHolds cron job (lib/jobs/release-expired-holds.ts), run
 * on demand through the dev-only POST /dev/jobs/:name (ENABLE_DEV_ENDPOINTS,
 * set for the E2E API). It releases every lapsed seat hold and emails
 * delegates whose checkout hold ran out within the last hour.
 *
 * The job sweeps the whole local database, so each test only asserts on its
 * own fresh delegates.
 */

const PASS = OPEN.products[0]
const SUBJECT = `Your seat hold expired — ${OPEN.name}`

async function runJob(name: string, body?: Record<string, unknown>) {
  const api = await newApiContext()
  try {
    const res = await api.post(`dev/jobs/${name}`, body ? { data: body } : {})
    return { status: res.status(), json: await res.json() }
  } finally {
    await api.dispose()
  }
}

async function heldSeat({ optOut = false } = {}): Promise<{ delegate: ApiSession; registrationId: string }> {
  const delegate = await signUpViaApi()
  if (optOut) {
    expect((await delegate.api.patch('account/notifications', { data: { enabled: false } })).status()).toBe(204)
  }
  const registrationId = await registerForPass(delegate, OPEN.slug, PASS.name)
  return { delegate, registrationId }
}

test('the job releases a lapsed checkout hold and emails the delegate, with no refund talk', async () => {
  const { delegate, registrationId } = await heldSeat()
  const running = await heldSeat()
  await expireSeatHold(registrationId, 30_000)

  const { status, json } = await runJob('releaseExpiredHolds')
  expect(status, JSON.stringify(json)).toBe(200)
  expect(json).toMatchObject({ job: 'releaseExpiredHolds', ok: true, durationMs: expect.any(Number) })
  expect(json.result.released).toBeGreaterThanOrEqual(1)
  expect(json.result.expiredCheckoutsNotified).toBeGreaterThanOrEqual(1)

  expect(await registrationStatus(registrationId)).toBe('CANCELLED')
  // A hold that is still running is left alone.
  expect(await registrationStatus(running.registrationId)).toBe('PAYMENT_PENDING')

  const mail = await waitForEmail(delegate.email, SUBJECT)
  expect(mail.text).toContain(PASS.name)
  expect(mail.text).toMatch(/expired before payment was completed/)
  expect(mail.text).not.toMatch(/refund/i)
  await expectNoEmail(running.delegate.email, SUBJECT, 500)

  // Running again releases nothing new and sends no second email.
  expect((await runJob('releaseExpiredHolds')).status).toBe(200)
  expect((await emailsTo(delegate.email)).filter((m) => m.subject === SUBJECT)).toHaveLength(1)
})

test('a delegate who turned email notifications off is released without an email', async () => {
  const { delegate, registrationId } = await heldSeat({ optOut: true })
  await expireSeatHold(registrationId, 30_000)
  expect((await runJob('releaseExpiredHolds')).status).toBe(200)
  expect(await registrationStatus(registrationId)).toBe('CANCELLED')
  await expectNoEmail(delegate.email, SUBJECT)
})

test('a hold that lapsed more than an hour ago is released silently', async () => {
  const { delegate, registrationId } = await heldSeat()
  await expireSeatHold(registrationId, 2 * 60 * 60 * 1000)
  expect((await runJob('releaseExpiredHolds')).status).toBe(200)
  expect(await registrationStatus(registrationId)).toBe('CANCELLED')
  await expectNoEmail(delegate.email, SUBJECT)
})

test('the dev job endpoint refuses unknown jobs and bad times', async () => {
  const unknown = await runJob('dropAllTables')
  expect(unknown.status).toBe(404)
  expect(unknown.json.error.code).toBe('NOT_FOUND')
  expect(unknown.json.error.message).toContain('releaseExpiredHolds')

  const badTime = await runJob('releaseExpiredHolds', { scheduledTime: 'yesterday-ish' })
  expect(badTime.status).toBe(400)
  expect(badTime.json.error.code).toBe('VALIDATION_FAILED')

  const withTime = await runJob('releaseExpiredHolds', { scheduledTime: new Date().toISOString() })
  expect(withTime.status).toBe(200)
})
