import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { API_ORIGIN, WEB_URL } from '../../env'
import { getMun, newApiContext, seedOrganizerLoginCode, signUpOrganizerViaApi, signUpViaApi } from '../../fixtures/api'
import { uniqueEmail } from '../../fixtures/data'
import { OPEN } from '../../fixtures/fixture-muns'
import { emailsTo, expectNoEmail, linkIn, waitForEmail } from '../../fixtures/outbox'
import { registerForPass } from '../../fixtures/payments'
import { expireSeatHold, paymentFor } from '../../fixtures/payments-fixture-db'
import { STORAGE_STATE } from '../../paths'

/**
 * Emails the product sends, read back from the local API's outbox
 * (EMAIL_OUTBOX_FILE, fixtures/outbox.ts). Each test uses fresh addresses,
 * so it only ever sees its own mail.
 */

async function adminApi(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL },
    storageState: STORAGE_STATE.admin,
  })
}

test.describe('organizer sign-in codes', () => {
  test('the emailed code signs a new organizer up, and never appears in the subject', async () => {
    const email = uniqueEmail('otp-mail')
    const api = await newApiContext()
    expect((await api.post('auth/organizers/code', { data: { email } })).status()).toBe(204)

    const mail = await waitForEmail(email, 'Your MUN Hub sign-in code')
    const code = mail.text.match(/\b(\d{6})\b/)?.[1]
    expect(code, 'code in the email body').toBeTruthy()
    expect(mail.subject).not.toMatch(/\d{6}/)
    expect(mail.html ?? '').toContain(code!)

    const res = await api.post('auth/organizers/session', {
      data: { email, code, profile: { name: 'E2E Mailed Code', acceptedTermsOfService: true, acceptedPrivacyPolicy: true } },
    })
    expect(res.status(), await res.text()).toBe(201)
    expect((await res.json()).role).toBe('ORGANIZER')

    // The code worked once.
    const replay = await (await newApiContext()).post('auth/organizers/session', { data: { email, code } })
    expect(replay.status()).toBe(400)
    await api.dispose()
  })

  test('a delegate address gets an explanation, never a code', async () => {
    const student = await signUpViaApi()
    const api = await newApiContext()
    expect((await api.post('auth/organizers/code', { data: { email: student.email } })).status()).toBe(204)
    const mail = await waitForEmail(student.email, 'MUN Hub organizer sign-in')
    expect(mail.text).toMatch(/delegate account/i)
    expect(mail.text).not.toMatch(/\b\d{6}\b/)
    expect((await emailsTo(student.email)).filter((m) => m.subject === 'Your MUN Hub sign-in code')).toEqual([])
    await api.dispose()
  })

  test('requesting a new code makes the emailed old one useless', async () => {
    const organizer = await signUpOrganizerViaApi()
    const api = await newApiContext()
    expect((await api.post('auth/organizers/code', { data: { email: organizer.email } })).status()).toBe(204)
    const first = await waitForEmail(organizer.email, 'Your MUN Hub sign-in code')
    const oldCode = first.text.match(/\b(\d{6})\b/)![1]
    // Plant a newer code (the resend cooldown blocks a second real request for a minute).
    await seedOrganizerLoginCode(organizer.email, oldCode === '000001' ? '000002' : '000001')
    const res = await api.post('auth/organizers/session', { data: { email: organizer.email, code: oldCode } })
    expect(res.status()).toBe(401)
    await api.dispose()
  })
})

test.describe('password reset', () => {
  test('the emailed link resets the password on this site', async ({ page }) => {
    const student = await signUpViaApi()
    const api = await newApiContext()
    expect((await api.post('password-reset/request', { data: { email: student.email } })).ok()).toBe(true)

    const mail = await waitForEmail(student.email, 'Reset your MUN Hub password')
    const link = linkIn(mail, '/reset-password')
    expect(link.origin).toBe(WEB_URL)
    expect(link.searchParams.get('token')).toMatch(/\S{20,}/)

    await page.goto(link.pathname + link.search)
    const newPassword = 'e2e-mailed-reset-password'
    await page.getByLabel('New password', { exact: true }).fill(newPassword)
    await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
    await page.getByRole('main').getByRole('button', { name: 'Reset password' }).click()
    await expect(page).toHaveURL(/\/login\?reset=success$/)

    const login = await api.post('auth/session', { data: { email: student.email, password: newPassword } })
    expect(login.status()).toBe(200)
    await api.dispose()
  })

  test('an unknown address gets no email', async () => {
    const ghost = uniqueEmail('ghost-reset')
    const api = await newApiContext()
    expect((await api.post('password-reset/request', { data: { email: ghost } })).ok()).toBe(true)
    await expectNoEmail(ghost, /.*/)
    await api.dispose()
  })
})

test.describe('organizer application decisions', () => {
  async function applyAndDecide(decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED', notes?: string) {
    const organizer = await signUpOrganizerViaApi()
    const munName = `E2E Mail Decision ${decision} ${Date.now()}`
    const applied = await organizer.api.post('organizer/applications', {
      data: {
        conferenceName: munName,
        location: 'Hyderabad',
        expectedDate: new Date(Date.now() + 120 * 86_400_000).toISOString(),
        expectedDelegateCount: 120,
        description: 'An E2E conference used to check decision emails.',
      },
    })
    expect(applied.status(), await applied.text()).toBe(201)
    const { munId } = (await applied.json()) as { munId: string }
    const admin = await adminApi()
    const decided = await admin.post(`admin/muns/${munId}/review-application`, {
      data: { decision, ...(notes ? { notes } : {}) },
    })
    expect(decided.status(), await decided.text()).toBeLessThan(300)
    await admin.dispose()
    return { organizer, munName }
  }

  test('approval tells the organizer they can start setting up', async () => {
    const { organizer, munName } = await applyAndDecide('APPROVED')
    const mail = await waitForEmail(organizer.email, `You're approved to host on MUN Hub — ${munName}`)
    expect(mail.text).toContain(munName)
    await organizer.api.dispose()
  })

  test('a change request carries the reviewer’s note', async () => {
    const note = `Please add the venue address (${Date.now()})`
    const { organizer, munName } = await applyAndDecide('CHANGES_REQUESTED', note)
    const mail = await waitForEmail(organizer.email, `Changes requested on your MUN Hub application — ${munName}`)
    expect(mail.text).toContain(note)
    await organizer.api.dispose()
  })

  test('a rejection is sent as an update, with the reason', async () => {
    const reason = `Not a fit right now (${Date.now()})`
    const { organizer, munName } = await applyAndDecide('REJECTED', reason)
    const mail = await waitForEmail(organizer.email, `Update on your MUN Hub application — ${munName}`)
    expect(mail.text).toContain(reason)
    expect(mail.text).not.toMatch(/refund/i)
    await organizer.api.dispose()
  })
})

test.describe('support replies', () => {
  async function ticketWithStaffReply(optOut: boolean) {
    const student = await signUpViaApi()
    if (optOut) {
      expect((await student.api.patch('account/notifications', { data: { enabled: false } })).status()).toBe(204)
    }
    const subject = `E2E mail ticket ${Date.now()}`
    const filed = await student.api.post('support/tickets', {
      data: { category: 'GENERAL', priority: 'LOW', subject, description: 'Where do I find my pass?' },
    })
    expect(filed.status(), await filed.text()).toBe(201)
    const { id } = (await filed.json()) as { id: string }

    // The requester's own message never triggers an email.
    await student.api.post(`support/conversations/${id}/messages`, { data: { body: 'Any update?' } })
    const admin = await adminApi()
    const reply = await admin.post(`support/conversations/${id}/messages`, { data: { body: 'It is on your dashboard.' } })
    expect(reply.status(), await reply.text()).toBe(201)
    await admin.dispose()
    return { student, subject }
  }

  test('a staff reply emails the delegate a link to their inbox, without the message text', async () => {
    const { student, subject } = await ticketWithStaffReply(false)
    const mail = await waitForEmail(student.email, `New reply on your support ticket — ${subject}`)
    expect(mail.text).not.toContain('It is on your dashboard.')
    expect(linkIn(mail, '/dashboard/support').pathname).toBe('/dashboard/support')
    expect((await emailsTo(student.email)).filter((m) => m.subject.startsWith('New reply'))).toHaveLength(1)
    await student.api.dispose()
  })

  test('an organizer\'s reply email points at the organizer inbox, and resolving sends nothing extra', async () => {
    const organizer = await signUpOrganizerViaApi('E2E Mail Organizer', uniqueEmail('support-mail-org'))
    const started = await organizer.api.post('support/conversations', { data: { body: `E2E organizer mail ${Date.now()}` } })
    expect(started.status(), await started.text()).toBe(201)
    const { ticket } = (await started.json()) as { ticket: { id: string; subject: string } }

    const admin = await adminApi()
    const reply = await admin.post(`support/conversations/${ticket.id}/messages`, {
      data: { body: 'Private staff answer', nextStatus: 'IN_PROGRESS' },
    })
    expect(reply.status(), await reply.text()).toBe(201)
    // Status changes alone (no message) never email.
    expect((await admin.patch(`admin/support/tickets/${ticket.id}`, { data: { status: 'RESOLVED', resolutionNotes: 'Done' } })).status()).toBe(200)
    await admin.dispose()

    const subject = `New reply on your support ticket — ${ticket.subject}`
    const mail = await waitForEmail(organizer.email, subject)
    expect(mail.text).not.toContain('Private staff answer')
    expect(linkIn(mail, '/organizer/support').pathname).toBe('/organizer/support')
    await expectNoEmail(organizer.email, /^(?!New reply on your support ticket)(.*support|.*ticket)/i, 1_000)
    expect((await emailsTo(organizer.email)).filter((m) => m.subject === subject)).toHaveLength(1)
    await organizer.api.dispose()
  })

  test('a delegate who turned email notifications off gets none', async () => {
    const { student, subject } = await ticketWithStaffReply(true)
    await expectNoEmail(student.email, `New reply on your support ticket — ${subject}`)
    await student.api.dispose()
  })
})

test.describe('registration payment emails', () => {
  const PASS = OPEN.products[0] // E2E Delegate Pass, ₹1,499
  const confirmedSubject = `Registration confirmed — ${OPEN.name}`
  const failedSubject = `Payment failed — ${OPEN.name}`

  async function delegate(optOut = false) {
    const session = await signUpViaApi()
    if (optOut) {
      expect((await session.api.patch('account/notifications', { data: { enabled: false } })).status()).toBe(204)
    }
    return session
  }

  test('a successful payment emails a confirmation with the pass and registration id, and no refund talk', async () => {
    const student = await delegate()
    const registrationId = await registerForPass(student, OPEN.slug, PASS.name, { pay: 'success' })
    const mail = await waitForEmail(student.email, confirmedSubject)
    expect(mail.text).toContain(PASS.name)
    expect(mail.text).toContain(registrationId)
    expect(mail.text).not.toMatch(/refund/i)
    await expectNoEmail(student.email, failedSubject, 500)
    expect((await emailsTo(student.email)).filter((m) => m.subject === confirmedSubject)).toHaveLength(1)
    await student.api.dispose()
  })

  test('the confirmation email states the amount actually paid', async () => {
    test.fail(
      !process.env.E2E_SHOW_KNOWN_BUGS,
      'BUG: lib/notifications/registration-events.ts formatMoney divides by 100 (treats amounts as paise), but payments.amount is whole rupees — a ₹1,499 payment is emailed as "INR 14.99".',
    )
    const student = await delegate()
    await registerForPass(student, OPEN.slug, PASS.name, { pay: 'success' })
    const mail = await waitForEmail(student.email, confirmedSubject)
    expect(mail.text).not.toContain('14.99')
    expect(mail.text).toMatch(/(₹|INR) ?1,?499\b/)
    await student.api.dispose()
  })

  test('a failed payment emails that the seat was released, with no refund talk', async () => {
    const student = await delegate()
    await registerForPass(student, OPEN.slug, PASS.name, { pay: 'failure' })
    const mail = await waitForEmail(student.email, failedSubject)
    expect(mail.text).toContain(PASS.name)
    expect(mail.text).toMatch(/seat hold has been released/)
    expect(mail.text).not.toMatch(/refund/i)
    await expectNoEmail(student.email, confirmedSubject, 500)
    await student.api.dispose()
  })

  test('a delegate who turned email notifications off gets neither', async () => {
    const paid = await delegate(true)
    await registerForPass(paid, OPEN.slug, PASS.name, { pay: 'success' })
    const failed = await delegate(true)
    await registerForPass(failed, OPEN.slug, PASS.name, { pay: 'failure' })
    await expectNoEmail(paid.email, confirmedSubject)
    await expectNoEmail(failed.email, failedSubject, 500)
    await paid.api.dispose()
    await failed.api.dispose()
  })

  test('holding a seat, and a payment that arrives after the hold lapsed, send no confirmation', async () => {
    const student = await delegate()
    const registrationId = await registerForPass(student, OPEN.slug, PASS.name)
    await expectNoEmail(student.email, /Registration confirmed|Payment failed/, 1_000)

    await expireSeatHold(registrationId)
    const mun = await getMun(student.api, OPEN.slug)
    await student.api.get(`products/availability?ids=${mun.registrationProducts.map((p) => p.id).join(',')}`)
    const pay = await student.api.post(`registrations/${registrationId}/mock-payment`, { data: { outcome: 'success' } })
    expect(await pay.json()).toEqual({ ok: true, exception: true })
    await expectNoEmail(student.email, /Registration confirmed|Payment failed/)

    const payment = await paymentFor(registrationId)
    const admin = await adminApi()
    await admin.post(`admin/payment-exceptions/${payment!.id}/resolve`, { data: { note: 'Returned (E2E email spec)' } })
    await admin.dispose()
    await student.api.dispose()
  })
})
