import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { API_ORIGIN, WEB_URL } from '../../env'
import { browserContextFor, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { parseCsv } from '../../fixtures/csv'
import { OPEN, OPS } from '../../fixtures/fixture-muns'
import {
  clearOpsAwards,
  communicationAuditRows,
  recreateOpsMun,
  setOpsMunStatus,
  setUserSuspended,
} from '../../fixtures/ops-fixture-db'
import { expectNoEmail, waitForEmail } from '../../fixtures/outbox'
import { watchForCrashes } from '../../fixtures/ui'
import { STORAGE_STATE } from '../../paths'
import { registerOnOpenMun } from '../student/_helpers'
import {
  acceptNextConfirm,
  anonApi,
  cardFor,
  createFreshOrganizer,
  main,
  openSection,
  organizerApi,
  ownedMunBySlug,
  sandboxId,
  toast,
  uid,
} from './_helpers'

/**
 * Conference-day operations on a MUN of our own (FIXTURE_MUNS.ops, recreated
 * here): the delegate pass, door check-in by code, delegate messages,
 * attendance marking and results submission (lib/actions/check-in.ts,
 * organizer-communications.ts, results.ts). The MUN starts REGISTRATION_OPEN
 * with the conference two hours away; later groups move it to
 * CONFERENCE_ACTIVE and on through results review. Each group sets the MUN
 * status it needs in its own beforeAll, so a worker restart mid-file (which
 * re-runs the file-level beforeAll and recreates everything) still works.
 */

const DELEGATE_PASS = OPS.products[0].name
const OBSERVER_PASS = OPS.products[1].name
const COMMITTEE = OPS.committees[0].name
const PRESS_ROOM = OPS.committees[1].name
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/

interface Delegate {
  session: ApiSession
  name: string
  registrationId: string
}

interface Pass {
  registrationId: string
  status: string
  checkedIn: boolean
  delegateName: string
  mun: { name: string; slug: string; venue: string | null; city: string | null }
  passName: string
  committee: string | null
  portfolio: string | null
  checkInCode: string
}

const tag = uid()
let api: APIRequestContext
let adminApi: APIRequestContext
let munId: string
let openId: string
/** Delegate pass, committee + portfolio, paid. Has optional emails turned OFF. */
let alpha: Delegate
/** Observer pass, press room, paid. */
let bravo: Delegate
/** Delegate pass, committee, paid — checked in through the UI. */
let charlie: Delegate
/** Delegate pass, committee, paid — marked a no-show. */
let delta: Delegate
/** Delegate pass, never paid. */
let unpaid: Delegate
/** Delegate pass, paid, then suspended. */
let suspended: Delegate

async function newDelegate(name: string, opts: { pass: string; committee?: string; portfolio?: string; pay: boolean }) {
  const session = await signUpViaApi({ name, institution: `E2E Ops Institute ${tag}` })
  const registrationId = await registerOnOpenMun(session, { slug: OPS.slug, ...opts })
  return { session, name, registrationId }
}

test.beforeAll(async () => {
  api = await organizerApi()
  adminApi = await request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL },
    storageState: STORAGE_STATE.admin,
  })
  munId = await recreateOpsMun()
  openId = (await ownedMunBySlug(api, OPEN.slug)).id

  alpha = await newDelegate(`E2E Ops Alpha ${tag}`, { pass: DELEGATE_PASS, committee: COMMITTEE, portfolio: 'Italy', pay: true })
  bravo = await newDelegate(`E2E Ops Bravo ${tag}`, { pass: OBSERVER_PASS, committee: PRESS_ROOM, pay: true })
  charlie = await newDelegate(`E2E Ops Charlie ${tag}`, { pass: DELEGATE_PASS, committee: COMMITTEE, portfolio: 'Spain', pay: true })
  delta = await newDelegate(`E2E Ops Delta ${tag}`, { pass: DELEGATE_PASS, committee: COMMITTEE, pay: true })
  unpaid = await newDelegate(`E2E Ops Unpaid ${tag}`, { pass: DELEGATE_PASS, committee: COMMITTEE, pay: false })
  suspended = await newDelegate(`E2E Ops Suspended ${tag}`, { pass: DELEGATE_PASS, committee: COMMITTEE, pay: true })

  const off = await alpha.session.api.patch('account/notifications', { data: { enabled: false } })
  expect(off.status(), await off.text()).toBe(204)
  await setUserSuspended(suspended.session.userId, true)
})

test.afterAll(async () => {
  if (suspended) await setUserSuspended(suspended.session.userId, false)
  for (const d of [alpha, bravo, charlie, delta, unpaid, suspended]) await d?.session.api.dispose()
  await api?.dispose()
  await adminApi?.dispose()
})

async function passFor(delegate: Delegate): Promise<Pass> {
  const res = await delegate.session.api.get(`me/registrations/${delegate.registrationId}/pass`)
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}

async function checkIn(client: APIRequestContext, code: string, mun = munId) {
  return client.post(`organizer/muns/${mun}/check-in`, { data: { code } })
}

async function delegatePage(browser: Browser, delegate: Delegate): Promise<Page> {
  const context = await browserContextFor(browser, delegate.session)
  return context.newPage()
}

async function rosterEntry(registrationId: string) {
  const res = await api.get(`organizer/muns/${munId}/delegates?search=${registrationId}`)
  expect(res.status(), await res.text()).toBe(200)
  const body = (await res.json()) as {
    results: Array<{ id: string; status: string }>
    munStatus: string
    attendanceOpen: boolean
  }
  return { ...body, row: body.results.find((r) => r.id === registrationId) }
}

function error(res: { json: () => Promise<unknown> }) {
  return res.json() as Promise<{ error: { code: string; message: string } }>
}

test.describe('delegate pass', () => {
  test.beforeAll(async () => {
    await setOpsMunStatus('REGISTRATION_OPEN')
  })

  test('the owner gets their pass with seat details and a check-in code', async () => {
    const res = await alpha.session.api.get(`me/registrations/${alpha.registrationId}/pass`)
    expect(res.status()).toBe(200)
    expect(res.headers()['cache-control']).toContain('no-store')
    const pass = (await res.json()) as Pass
    expect(pass).toMatchObject({
      registrationId: alpha.registrationId,
      status: 'CONFIRMED',
      checkedIn: false,
      delegateName: alpha.name,
      passName: DELEGATE_PASS,
      committee: COMMITTEE,
      portfolio: 'Italy',
      mun: { name: OPS.name, slug: OPS.slug, venue: 'E2E Convention Centre', city: 'Hyderabad' },
    })
    expect(pass.checkInCode).toMatch(CODE_PATTERN)
    // Stable: the code is derived, not re-issued per request.
    expect((await passFor(alpha)).checkInCode).toBe(pass.checkInCode)
    // Every registration has its own code.
    expect((await passFor(bravo)).checkInCode).not.toBe(pass.checkInCode)
  })

  test('nobody but the owner can read a pass — not another delegate, the organizer or staff', async () => {
    const path = `me/registrations/${alpha.registrationId}/pass`
    expect((await bravo.session.api.get(path)).status()).toBe(404)
    expect((await api.get(path)).status()).toBe(404)
    expect((await adminApi.get(path)).status()).toBe(404)
    const anon = await anonApi()
    expect((await anon.get(path)).status()).toBe(401)
    await anon.dispose()
    expect((await alpha.session.api.get(`me/registrations/${crypto.randomUUID()}/pass`)).status()).toBe(404)
  })

  test('an unpaid registration has no pass yet', async () => {
    const res = await unpaid.session.api.get(`me/registrations/${unpaid.registrationId}/pass`)
    expect(res.status()).toBe(409)
    expect((await error(res)).error.message).toBe('Your pass is available once your registration is confirmed')
  })

  test('the pass page shows the conference, seat and code, and the dashboard links to it', async ({ browser }) => {
    const pass = await passFor(alpha)
    const page = await delegatePage(browser, alpha)
    const crashes = watchForCrashes(page)

    await page.goto('/dashboard')
    await main(page).getByRole('link', { name: 'View pass' }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/registrations/${alpha.registrationId}/pass$`))
    await expect(page.getByRole('heading', { level: 1, name: OPS.name })).toBeVisible()
    await expect(main(page)).toContainText('Delegate pass')
    await expect(main(page)).toContainText(alpha.name)
    await expect(main(page)).toContainText(DELEGATE_PASS)
    await expect(main(page)).toContainText(`${COMMITTEE} · Italy`)
    await expect(main(page)).toContainText('E2E Convention Centre, 7 Check-in Road, Hyderabad, Telangana, India')
    await expect(main(page).getByText(pass.checkInCode, { exact: true })).toBeVisible()
    await expect(main(page)).toContainText('Show this code at the registration desk')
    await expect(main(page)).toContainText(alpha.registrationId)
    await expect(main(page).getByRole('button', { name: 'Print pass' })).toBeVisible()
    crashes.assertNone()
    await page.context().close()
  })

  test('another delegate opening the pass URL sees "Pass not found", without the code', async ({ browser }) => {
    const code = (await passFor(alpha)).checkInCode
    const page = await delegatePage(browser, bravo)
    const crashes = watchForCrashes(page)
    await page.goto(`/dashboard/registrations/${alpha.registrationId}/pass`)
    await expect(main(page).getByText('Pass not found')).toBeVisible()
    await expect(main(page)).toContainText("We couldn't find a pass for this registration on your account.")
    await expect(main(page)).not.toContainText(code)
    await expect(main(page)).not.toContainText(alpha.name)
    crashes.assertNone()
    await page.context().close()
  })

  test('an unpaid delegate sees that the pass is not ready, and gets no pass link', async ({ browser }) => {
    const page = await delegatePage(browser, unpaid)
    const crashes = watchForCrashes(page)
    await page.goto('/dashboard')
    await expect(main(page)).toContainText(OPS.name)
    await expect(main(page).getByRole('link', { name: 'View pass' })).toHaveCount(0)

    await page.goto(`/dashboard/registrations/${unpaid.registrationId}/pass`)
    await expect(main(page).getByText("Your pass isn't ready yet")).toBeVisible()
    await expect(main(page)).toContainText('Your pass is available once your registration is confirmed')
    await expect(main(page).getByRole('button', { name: 'Print pass' })).toHaveCount(0)
    crashes.assertNone()
    await page.context().close()
  })

  test('a signed-out visitor is sent to sign in', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    await page.goto(`/dashboard/registrations/${alpha.registrationId}/pass`)
    await expect(page).toHaveURL(/\/login\?redirectTo=/)
    await context.close()
  })
})

test.describe('door check-in', () => {
  test.beforeAll(async () => {
    await setOpsMunStatus('REGISTRATION_OPEN')
  })

  test('a code checks the delegate in once; a repeat scan reports the original time', async () => {
    const pass = await passFor(bravo)
    // Typed sloppily: lower case, a space instead of the hyphen.
    const first = await checkIn(api, pass.checkInCode.toLowerCase().replace('-', ' '))
    expect(first.status(), await first.text()).toBe(200)
    const checked = await first.json()
    expect(checked).toMatchObject({
      outcome: 'CHECKED_IN',
      delegate: {
        registrationId: bravo.registrationId,
        name: bravo.name,
        institution: `E2E Ops Institute ${tag}`,
        passName: OBSERVER_PASS,
        committee: PRESS_ROOM,
        portfolio: null,
      },
    })

    const again = await checkIn(api, pass.checkInCode)
    expect(again.status()).toBe(200)
    const repeat = await again.json()
    expect(repeat.outcome).toBe('ALREADY_CHECKED_IN')
    expect(repeat.checkedInAt).toBe(checked.checkedInAt)

    expect(await passFor(bravo)).toMatchObject({ status: 'ATTENDED', checkedIn: true })
    expect((await rosterEntry(bravo.registrationId)).row?.status).toBe('ATTENDED')
  })

  test('platform staff can check a delegate in too', async () => {
    const res = await checkIn(adminApi, (await passFor(bravo)).checkInCode)
    expect(res.status(), await res.text()).toBe(200)
    expect((await res.json()).delegate.registrationId).toBe(bravo.registrationId)
  })

  test('malformed, unknown and other-MUN codes are refused', async () => {
    const malformed = await checkIn(api, 'not-a-code')
    expect(malformed.status()).toBe(400)
    expect((await error(malformed)).error.message).toBe("Enter the 10-character check-in code from the delegate's pass")

    const unknown = await checkIn(api, 'ZZZZZ-ZZZZZ')
    expect(unknown.status()).toBe(404)
    expect((await error(unknown)).error.message).toBe('No confirmed registration for this MUN matches that code')

    // A real pass — for a different MUN.
    const outsider = await signUpViaApi({ name: `E2E Ops Outsider ${tag}` })
    const outsiderReg = await registerOnOpenMun(outsider, { pay: true })
    const outsiderPass = await outsider.api.get(`me/registrations/${outsiderReg}/pass`)
    expect(outsiderPass.status()).toBe(200)
    const foreign = await checkIn(api, (await outsiderPass.json()).checkInCode)
    expect(foreign.status()).toBe(404)
    expect((await outsider.api.get(`registrations/${outsiderReg}`)).ok()).toBe(true)
    expect((await (await outsider.api.get(`registrations/${outsiderReg}`)).json()).status).toBe('CONFIRMED')
    await outsider.api.dispose()
  })

  test('check-in stays closed before the MUN is live and until 24 hours before it starts', async () => {
    const onboarding = await checkIn(api, 'ZZZZZ-ZZZZZ', await sandboxId(api))
    expect(onboarding.status()).toBe(409)
    expect((await error(onboarding)).error.message).toBe(
      'Check-in is only available once the MUN is live and until the conference ends',
    )
    // The open fixture is live, but its conference is three months away.
    const early = await checkIn(api, 'ZZZZZ-ZZZZZ', openId)
    expect(early.status()).toBe(409)
    expect((await error(early)).error.message).toBe('Check-in opens 24 hours before the conference starts')
  })

  test('Conference day: typing a code checks the delegate in, and a repeat shows "already checked in"', async ({ page }) => {
    const crashes = watchForCrashes(page)
    const pass = await passFor(charlie)
    await openSection(page, munId, 'conference-day', /^Conference day$/i)
    const code = main(page).getByLabel('Check-in code')
    const submit = main(page).getByRole('button', { name: 'Check in', exact: true })
    await expect(submit).toBeDisabled()

    await code.fill(pass.checkInCode)
    await submit.click()
    await expect(main(page).getByText('Checked in', { exact: true })).toBeVisible()
    await expect(main(page)).toContainText(charlie.name)
    await expect(main(page)).toContainText(`${DELEGATE_PASS} · ${COMMITTEE} · Spain`)
    await expect(code).toHaveValue('')
    const recent = main(page).getByRole('listitem').filter({ hasText: charlie.name })
    await expect(main(page).getByRole('heading', { name: 'Checked in on this device' })).toBeVisible()
    await expect(recent).toHaveCount(1)

    await code.fill(pass.checkInCode)
    await code.press('Enter')
    await expect(main(page).getByText(/^Already checked in at /)).toBeVisible()
    await expect(recent).toHaveCount(1)

    await code.fill('ZZZZZ-ZZZZZ')
    await submit.click()
    await expect(main(page).getByText('No confirmed registration for this MUN matches that code')).toBeVisible()

    expect((await rosterEntry(charlie.registrationId)).row?.status).toBe('ATTENDED')
    crashes.assertNone()
  })

  test('Conference day: check-in is disabled for a MUN that is not live', async ({ page }) => {
    await openSection(page, await sandboxId(api), 'conference-day', /^Conference day$/i)
    await expect(main(page)).toContainText('Check-in opens once registration is open, from 24 hours before the conference starts.')
    await expect(main(page).getByLabel('Check-in code')).toBeDisabled()
    await expect(main(page).getByRole('button', { name: 'Check in', exact: true })).toBeDisabled()
  })
})

test.describe('delegate messages', () => {
  const subjectOf = (subject: string) => `${OPS.name}: ${subject}`

  test('the audience preview counts seat holders once, skipping unpaid and suspended accounts', async () => {
    const preview = async (query = '') => {
      const res = await api.get(`organizer/muns/${munId}/communications/audience${query}`)
      expect(res.status(), await res.text()).toBe(200)
      return res.json()
    }
    const passes = (await (await api.get(`muns/${OPS.slug}`)).json()).registrationProducts as Array<{ id: string; name: string }>
    const committees = (await (await api.get(`muns/${OPS.slug}`)).json()).committees as Array<{ id: string; name: string }>
    const observerId = passes.find((p) => p.name === OBSERVER_PASS)!.id
    const committeeId = committees.find((c) => c.name === COMMITTEE)!.id

    expect(await preview()).toMatchObject({ recipientCount: 4, maxRecipientsPerSend: 500 })
    expect((await preview()).sendsRemainingThisHour).toBeGreaterThan(0)
    // alpha, charlie, delta — not the unpaid or suspended delegate.
    expect((await preview(`?committeeId=${committeeId}`)).recipientCount).toBe(3)
    expect((await preview(`?registrationProductId=${observerId}`)).recipientCount).toBe(1)
    expect((await preview(`?status=NO_SHOW&registrationProductId=${observerId}`)).recipientCount).toBe(0)
    expect((await api.get(`organizer/muns/${munId}/communications/audience?status=PENDING`)).status()).toBe(400)
  })

  test('a message reaches exactly its audience, HTML-escaped, and is recorded', async () => {
    const committees = (await (await api.get(`muns/${OPS.slug}`)).json()).committees as Array<{ id: string; name: string }>
    const pressRoomId = committees.find((c) => c.name === PRESS_ROOM)!.id
    const subject = `Press room moved ${tag}`
    const body = 'The press room is now in Hall B.\n\nBring your <b>badge</b> & laptop.'
    const sentAfter = new Date()

    const res = await api.post(`organizer/muns/${munId}/communications`, {
      data: { subject, body, audience: { committeeId: pressRoomId } },
    })
    expect(res.status(), await res.text()).toBe(201)
    expect(await res.json()).toEqual({ recipientCount: 1, sent: 1, failed: 0 })

    const email = await waitForEmail(bravo.session.email, subjectOf(subject), { after: sentAfter })
    expect(email.text).toContain('The press room is now in Hall B.')
    expect(email.text).toContain(`Sent by the organizers of ${OPS.name}.`)
    expect(email.html).toContain('Bring your &lt;b&gt;badge&lt;/b&gt; &amp; laptop.')
    expect(email.html).not.toContain('<b>badge</b>')
    await expectNoEmail(charlie.session.email, subjectOf(subject), 500)

    const history = (await (await api.get(`organizer/muns/${munId}/communications`)).json()) as Array<Record<string, unknown>>
    expect(history[0]).toMatchObject({ subject, recipientCount: 1 })
    expect(typeof history[0].sentBy).toBe('string')
    const audit = (await communicationAuditRows(munId)).at(-1)
    expect(audit?.notes).toBe(`Delegate message "${subject}" to 1 recipient`)
  })

  test('a delegate who turned optional emails off still gets conference messages; unpaid and suspended ones do not', async () => {
    const committees = (await (await api.get(`muns/${OPS.slug}`)).json()).committees as Array<{ id: string; name: string }>
    const committeeId = committees.find((c) => c.name === COMMITTEE)!.id
    const account = await (await alpha.session.api.get('account')).json()
    expect(account.emailNotificationsEnabled).toBe(false)

    const subject = `Day one schedule ${tag}`
    const res = await api.post(`organizer/muns/${munId}/communications`, {
      data: { subject, body: 'Opening ceremony at 9 AM sharp.', audience: { committeeId } },
    })
    expect(res.status(), await res.text()).toBe(201)
    expect(await res.json()).toEqual({ recipientCount: 3, sent: 3, failed: 0 })

    // Operational messages deliberately ignore the optional-email preference
    // (lib/actions/organizer-communications.ts).
    await waitForEmail(alpha.session.email, subjectOf(subject))
    await waitForEmail(charlie.session.email, subjectOf(subject))
    await waitForEmail(delta.session.email, subjectOf(subject))
    await expectNoEmail(unpaid.session.email, subjectOf(subject), 500)
    await expectNoEmail(suspended.session.email, subjectOf(subject), 0)
    await expectNoEmail(bravo.session.email, subjectOf(subject), 0)
  })

  test('invalid messages and empty audiences are refused without using up a send', async () => {
    const before = (await communicationAuditRows(munId)).length
    const send = (data: Record<string, unknown>) => api.post(`organizer/muns/${munId}/communications`, { data })
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ subject: '  ', body: 'Hello', audience: {} }, 'Subject is required'],
      [{ subject: 'Line one\nLine two', body: 'Hello', audience: {} }, 'Subject must be a single line'],
      [{ subject: 'x'.repeat(151), body: 'Hello', audience: {} }, 'Subject must be at most 150 characters'],
      [{ subject: 'Hello', body: '   ', audience: {} }, 'Message is required'],
      [{ subject: 'Hello', body: 'x'.repeat(5001), audience: {} }, 'Message must be at most 5000 characters'],
      [{ subject: 'Hello', body: 'Hello', audience: { statuses: ['NO_SHOW'] } }, 'No delegates match this audience'],
    ]
    for (const [data, message] of cases) {
      const res = await send(data)
      expect(res.status(), message).toBe(400)
      expect((await error(res)).error.message).toBe(message)
    }
    // Only seat-holding statuses can be targeted, and unknown fields are rejected.
    expect((await send({ subject: 'Hello', body: 'Hello', audience: { statuses: ['PENDING'] } })).status()).toBe(400)
    expect((await send({ subject: 'Hello', body: 'Hello', audience: {}, html: '<p>x</p>' })).status()).toBe(400)
    expect((await communicationAuditRows(munId)).length).toBe(before)
  })

  test('the composer validates, shows the recipient count and the history', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await openSection(page, munId, 'communications', 'Communications')
    await expect(main(page)).toContainText("Delegates receive this even if they've turned off optional emails")
    await expect(main(page).getByText('4 delegates', { exact: true })).toBeVisible()
    await expect(main(page)).toContainText('Will be sent to 4 delegates.')

    await main(page).getByRole('button', { name: 'Send message' }).click()
    await expect(main(page).getByText('Add a subject.')).toBeVisible()
    await expect(main(page).getByText('Write a message.')).toBeVisible()

    await main(page).getByLabel('Pass').selectOption({ label: OBSERVER_PASS })
    await expect(main(page).getByText('1 delegate', { exact: true })).toBeVisible()
    await main(page).getByLabel('Delegates').selectOption({ label: 'Marked no-show' })
    await expect(main(page).getByRole('heading', { name: 'No delegates match these filters' })).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Send message' })).toBeDisabled()

    // Earlier sends are listed, newest first.
    const recent = main(page).getByRole('listitem').filter({ hasText: `Day one schedule ${tag}` })
    await expect(recent).toContainText('3 recipients')
    crashes.assertNone()
  })

  test('the hourly send limit is enforced and shown', async ({ page }) => {
    const preview = await (await api.get(`organizer/muns/${munId}/communications/audience`)).json()
    for (let i = 0; i < preview.sendsRemainingThisHour; i += 1) {
      const res = await api.post(`organizer/muns/${munId}/communications`, {
        data: { subject: `Filler ${i} ${tag}`, body: 'Filler message.', audience: { statuses: ['ATTENDED'] } },
      })
      expect(res.status(), await res.text()).toBe(201)
    }
    const limited = await api.post(`organizer/muns/${munId}/communications`, {
      data: { subject: `One too many ${tag}`, body: 'Should not send.', audience: {} },
    })
    expect(limited.status()).toBe(429)
    expect((await error(limited)).error.message).toBe(
      'This MUN has reached its limit of 5 delegate messages per hour — try again later',
    )
    await expectNoEmail(alpha.session.email, subjectOf(`One too many ${tag}`), 500)

    await openSection(page, munId, 'communications', 'Communications')
    await expect(main(page)).toContainText("You've sent the maximum number of messages for this hour.")
    await main(page).getByLabel('Subject').fill('Blocked')
    await main(page).getByLabel('Message').fill('Blocked')
    await expect(main(page).getByRole('button', { name: 'Send message' })).toBeDisabled()
  })
})

test.describe('attendance', () => {
  test.beforeAll(async () => {
    await setOpsMunStatus('REGISTRATION_OPEN')
  })

  test('attendance cannot be recorded before the conference is under way', async () => {
    const entry = await rosterEntry(alpha.registrationId)
    expect(entry).toMatchObject({ munStatus: 'REGISTRATION_OPEN', attendanceOpen: false })
    const res = await api.put(`organizer/muns/${munId}/delegates/${alpha.registrationId}/attendance`, {
      data: { status: 'ATTENDED' },
    })
    expect(res.status()).toBe(409)
    expect((await error(res)).error.message).toBe(
      'Attendance can only be recorded while the conference is active or awaiting results',
    )
  })

  test.describe('during the conference', () => {
    test.beforeAll(async () => {
      await setOpsMunStatus('CONFERENCE_ACTIVE')
    })

    const mark = (client: APIRequestContext, registrationId: string, status: string) =>
      client.put(`organizer/muns/${munId}/delegates/${registrationId}/attendance`, { data: { status } })

    test('the owner and staff can mark attendance; only seat holders of this MUN qualify', async () => {
      expect(await rosterEntry(delta.registrationId)).toMatchObject({ munStatus: 'CONFERENCE_ACTIVE', attendanceOpen: true })

      const noShow = await mark(api, delta.registrationId, 'NO_SHOW')
      expect(noShow.status(), await noShow.text()).toBe(200)
      const first = await noShow.json()
      expect(first).toMatchObject({ registrationId: delta.registrationId, status: 'NO_SHOW' })
      // Setting the same status again changes nothing.
      const repeat = await (await mark(api, delta.registrationId, 'NO_SHOW')).json()
      expect(repeat.updatedAt).toBe(first.updatedAt)
      expect((await rosterEntry(delta.registrationId)).row?.status).toBe('NO_SHOW')

      // A late arrival: staff at the door can mark them attended, then back.
      expect((await mark(adminApi, delta.registrationId, 'ATTENDED')).status()).toBe(200)
      expect((await rosterEntry(delta.registrationId)).row?.status).toBe('ATTENDED')
      expect((await mark(api, delta.registrationId, 'NO_SHOW')).status()).toBe(200)

      const notSeated = await mark(api, unpaid.registrationId, 'ATTENDED')
      expect(notSeated.status()).toBe(409)
      expect((await error(notSeated)).error.message).toBe('Only confirmed registrations can be marked attended or no-show')

      expect((await mark(api, crypto.randomUUID(), 'ATTENDED')).status()).toBe(404)
      expect((await mark(api, alpha.registrationId, 'CONFIRMED')).status()).toBe(400)
    })

    test('the roster and the delegate drawer mark attended and no-show', async ({ page }) => {
      const crashes = watchForCrashes(page)
      expect((await mark(api, alpha.registrationId, 'ATTENDED')).status()).toBe(200)

      await openSection(page, munId, 'registrations', 'Registrations')
      await expect(main(page)).toContainText('The conference is under way — record attendance')
      await main(page).getByLabel('Search delegates').fill(alpha.name)
      const row = main(page).getByRole('row').filter({ hasText: alpha.session.email })
      await expect(row).toHaveCount(1)
      await expect(main(page).getByRole('row')).toHaveCount(2)
      await expect(row).toContainText('Attended')
      await expect(row.getByRole('button', { name: `Mark ${alpha.name} attended` })).toHaveCount(0)

      await row.getByRole('button', { name: `Mark ${alpha.name} no-show` }).click()
      await expect(toast(page, 'Marked as no-show')).toBeVisible()
      await expect(row).toContainText('No show')
      expect((await rosterEntry(alpha.registrationId)).row?.status).toBe('NO_SHOW')

      await row.getByRole('button', { name: `Mark ${alpha.name} attended` }).click()
      await expect(toast(page, 'Marked as attended')).toBeVisible()
      await expect(row.getByRole('button', { name: `Mark ${alpha.name} no-show` })).toBeVisible()

      await row.getByRole('button', { name: 'View' }).click()
      const drawer = page.getByRole('dialog')
      await expect(drawer.getByRole('heading', { name: alpha.name })).toBeVisible()
      await expect(drawer).toContainText(/Checked in · /)
      await expect(drawer.getByRole('button', { name: 'Mark attended' })).toBeDisabled()
      await drawer.getByRole('button', { name: 'Mark no-show' }).click()
      await expect(drawer).toContainText(/Marked as no-show · /)
      await expect(drawer.getByRole('button', { name: 'Mark no-show' })).toBeDisabled()
      await drawer.getByRole('button', { name: 'Mark attended' }).click()
      await expect(drawer).toContainText(/Checked in · /)
      await page.keyboard.press('Escape')
      await expect(drawer).toHaveCount(0)
      expect((await rosterEntry(alpha.registrationId)).row?.status).toBe('ATTENDED')
      crashes.assertNone()
    })
  })
})

test.describe('results', () => {
  // Each step builds on the previous one's MUN status.
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    await setOpsMunStatus('CONFERENCE_ACTIVE')
    await clearOpsAwards(munId)
  })

  const award = `E2E Best Delegate ${tag}`

  test('results need an award from a confirmed or attended delegate before they can be submitted', async () => {
    const state = await (await api.get(`organizer/muns/${munId}/results`)).json()
    expect(state).toEqual({
      munStatus: 'CONFERENCE_ACTIVE',
      awardCount: 0,
      editable: true,
      canSubmit: true,
      submittedAt: null,
      returnNote: null,
    })

    const empty = await api.post(`organizer/muns/${munId}/results/submit`)
    expect(empty.status()).toBe(409)
    expect((await error(empty)).error.message).toBe('Record at least one award before submitting results')

    // An unpaid delegate, and a no-show (delta is marked one here; the
    // attendance group may not have run in this worker).
    const noShow = await api.put(`organizer/muns/${munId}/delegates/${delta.registrationId}/attendance`, {
      data: { status: 'NO_SHOW' },
    })
    expect(noShow.status(), await noShow.text()).toBe(200)
    for (const who of [unpaid, delta]) {
      const res = await api.post(`organizer/muns/${munId}/achievements`, {
        data: { registrationId: who.registrationId, award: 'Honourable Mention' },
      })
      expect(res.status(), who.name).toBe(409)
      expect((await error(res)).error.message).toBe('Awards can only be given to confirmed or attended delegates')
    }
    expect((await (await api.get(`organizer/muns/${munId}/results`)).json()).awardCount).toBe(0)
  })

  test('award a delegate and submit the results for review', async ({ page }) => {
    const crashes = watchForCrashes(page)
    await openSection(page, munId, 'results', 'Results & Awards')
    await expect(main(page).getByRole('heading', { name: 'Ready to submit results' })).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Submit results for review' })).toBeDisabled()

    await main(page).getByRole('button', { name: 'Add award' }).first().click()
    const form = main(page).locator('form')
    await form.getByLabel('Search roster').fill(charlie.name)
    const delegate = form.getByLabel('Delegate', { exact: true })
    await expect(delegate.getByRole('option', { name: `${charlie.name} — ${COMMITTEE}` })).toHaveCount(1)
    // The picker only offers confirmed or checked-in delegates.
    await form.getByLabel('Search roster').fill(unpaid.name)
    await expect(delegate.getByRole('option')).toHaveText(['Select a delegate'])
    await form.getByLabel('Search roster').fill(charlie.name)
    await delegate.selectOption({ label: `${charlie.name} — ${COMMITTEE}` })
    await form.getByLabel('Award').fill(award)
    await form.getByRole('button', { name: 'Add award' }).click()
    await expect(toast(page, 'Award recorded')).toBeVisible()

    const card = cardFor(page, 'Awards', award)
    await expect(card).toContainText(`${charlie.name} (${charlie.session.email})`)
    await expect(card).toContainText(`${COMMITTEE} · Spain`)
    await expect(main(page)).toContainText('1 award recorded.')

    acceptNextConfirm(page)
    await main(page).getByRole('button', { name: 'Submit results for review' }).click()
    await expect(toast(page, 'Results submitted for review')).toBeVisible()
    await expect(main(page).getByRole('heading', { name: 'Results under review' })).toBeVisible()
    await expect(main(page).getByRole('button', { name: /add award/i })).toHaveCount(0)
    await expect(main(page).getByRole('button', { name: `Delete award: ${award}` })).toHaveCount(0)
    crashes.assertNone()

    const state = await (await api.get(`organizer/muns/${munId}/results`)).json()
    expect(state).toMatchObject({ munStatus: 'RESULTS_UNDER_REVIEW', awardCount: 1, editable: false, canSubmit: false })
    expect(state.submittedAt).toBeTruthy()
    expect((await ownedMunBySlug(api, OPS.slug)).status).toBe('RESULTS_UNDER_REVIEW')
  })

  test('submitted results are locked: no new awards, deletions, attendance changes or resubmission', async () => {
    const achievements = (await (await api.get(`organizer/muns/${munId}/achievements`)).json()) as Array<{ id: string }>
    expect(achievements).toHaveLength(1)

    const add = await api.post(`organizer/muns/${munId}/achievements`, {
      data: { registrationId: alpha.registrationId, award: 'Too late' },
    })
    expect(add.status()).toBe(409)
    expect((await error(add)).error.message).toBe(
      'Results are locked while they are under review and once the conference is completed',
    )
    expect((await api.delete(`achievements/${achievements[0].id}`)).status()).toBe(409)
    const attendance = await api.put(`organizer/muns/${munId}/delegates/${alpha.registrationId}/attendance`, {
      data: { status: 'NO_SHOW' },
    })
    expect(attendance.status()).toBe(409)
    const resubmit = await api.post(`organizer/muns/${munId}/results/submit`)
    expect(resubmit.status()).toBe(409)
    expect((await error(resubmit)).error.message).toBe('Cannot submit results while the MUN is RESULTS_UNDER_REVIEW')
  })

  test('staff return results with a note, the organizer resubmits, and staff approve', async ({ page }) => {
    const review = (client: APIRequestContext, data: Record<string, unknown>) =>
      client.post(`admin/muns/${munId}/results/review`, { data })

    // Only staff decide.
    expect((await review(api, { decision: 'APPROVE' })).status()).toBe(403)
    const noNote = await review(adminApi, { decision: 'RETURN' })
    expect(noNote.status()).toBe(400)
    expect((await error(noNote)).error.message).toBe('A note is required when returning results to the organizer')

    const note = `Please add the committee chairs' awards ${tag}`
    const returned = await review(adminApi, { decision: 'RETURN', note })
    expect(returned.status(), await returned.text()).toBe(200)
    expect(await (await api.get(`organizer/muns/${munId}/results`)).json()).toMatchObject({
      munStatus: 'RESULTS_PENDING',
      editable: true,
      canSubmit: true,
      returnNote: note,
    })

    await openSection(page, munId, 'results', 'Results & Awards')
    await expect(main(page).getByRole('heading', { name: 'MUNHub sent your results back' })).toBeVisible()
    await expect(main(page)).toContainText(note)
    await expect(main(page).getByRole('button', { name: `Delete award: ${award}` })).toBeVisible()

    const resubmitted = await api.post(`organizer/muns/${munId}/results/submit`)
    expect(resubmitted.status(), await resubmitted.text()).toBe(200)
    expect((await resubmitted.json()).munStatus).toBe('RESULTS_UNDER_REVIEW')

    const approved = await review(adminApi, { decision: 'APPROVE' })
    expect(approved.status(), await approved.text()).toBe(200)
    const again = await review(adminApi, { decision: 'APPROVE' })
    expect(again.status()).toBe(409)
    expect((await error(again)).error.message).toBe('These results are not awaiting review')

    await page.reload()
    await expect(main(page).getByRole('heading', { name: 'Results approved' })).toBeVisible()
    await expect(cardFor(page, 'Awards', award)).toContainText('Verified')
    await expect(main(page).getByRole('button', { name: /add award|delete award/i })).toHaveCount(0)
  })
})

test.describe('roster export', () => {
  test.beforeAll(async () => {
    await setOpsMunStatus('REGISTRATION_OPEN')
  })

  test('free text is quoted and spreadsheet formulas are neutralised', async () => {
    const name = `E2E "Quoted", Delegate ${tag}`
    const institution = `=HYPERLINK("http://evil.example") ${tag}`
    const tricky = await signUpViaApi({ name, institution })
    const registrationId = await registerOnOpenMun(tricky, {
      slug: OPS.slug,
      pass: DELEGATE_PASS,
      committee: COMMITTEE,
      portfolio: 'Italy',
      pay: true,
    })

    const res = await api.get(`organizer/muns/${munId}/delegates/export?search=${encodeURIComponent(tricky.email)}`)
    expect(res.status(), await res.text()).toBe(200)
    const text = (await res.body()).toString('utf8')
    const csv = parseCsv(text)
    expect(csv.rows).toHaveLength(1)
    const cell = (column: string) => csv.rows[0][csv.header.indexOf(column)]
    expect(cell('Registration ID')).toBe(registrationId)
    expect(cell('Name')).toBe(name)
    expect(text).toContain(`"E2E ""Quoted"", Delegate ${tag}"`)
    expect(cell('Institution')).toBe(`'${institution}`)
    expect(cell('Amount')).toBe(String(OPS.products[0].price))
    await tricky.api.dispose()
  })

  test('the export follows the status and pass filters', async () => {
    const passes = (await (await api.get(`muns/${OPS.slug}`)).json()).registrationProducts as Array<{ id: string; name: string }>
    const observerId = passes.find((p) => p.name === OBSERVER_PASS)!.id
    const exportIds = async (query: string) => {
      const res = await api.get(`organizer/muns/${munId}/delegates/export?${query}`)
      expect(res.status(), await res.text()).toBe(200)
      return parseCsv((await res.body()).toString('utf8')).rows.map((r) => r[0])
    }
    expect(await exportIds(`registrationProductId=${observerId}`)).toEqual([bravo.registrationId])
    const holding = await exportIds('status=PENDING,PAYMENT_PENDING')
    expect(holding).toContain(unpaid.registrationId)
    expect(holding).not.toContain(alpha.registrationId)
    expect((await api.get(`organizer/muns/${munId}/delegates/export?limit=5`)).status()).toBe(400)
  })
})

test.describe('tenant boundaries of the operations APIs', () => {
  type Call = { name: string; send: (client: APIRequestContext) => Promise<{ status: () => number }> }

  function ownerOnlyCalls(): Call[] {
    return [
      { name: 'delegate detail', send: (c) => c.get(`organizer/muns/${munId}/delegates/${alpha.registrationId}`) },
      { name: 'roster export', send: (c) => c.get(`organizer/muns/${munId}/delegates/export`) },
      { name: 'message history', send: (c) => c.get(`organizer/muns/${munId}/communications`) },
      { name: 'audience preview', send: (c) => c.get(`organizer/muns/${munId}/communications/audience`) },
      {
        name: 'send message',
        send: (c) =>
          c.post(`organizer/muns/${munId}/communications`, {
            data: { subject: `Intruder ${tag}`, body: 'Should never be sent.', audience: {} },
          }),
      },
    ]
  }

  function ownerOrStaffCalls(): Call[] {
    return [
      { name: 'check-in', send: (c) => c.post(`organizer/muns/${munId}/check-in`, { data: { code: 'ZZZZZ-ZZZZZ' } }) },
      {
        name: 'attendance',
        send: (c) =>
          c.put(`organizer/muns/${munId}/delegates/${alpha.registrationId}/attendance`, { data: { status: 'NO_SHOW' } }),
      },
    ]
  }

  function ownerOrAdminCalls(): Call[] {
    return [
      { name: 'roster', send: (c) => c.get(`organizer/muns/${munId}/delegates`) },
      { name: 'results state', send: (c) => c.get(`organizer/muns/${munId}/results`) },
      { name: 'submit results', send: (c) => c.post(`organizer/muns/${munId}/results/submit`) },
      { name: 'staff results review', send: (c) => c.post(`admin/muns/${munId}/results/review`, { data: { decision: 'APPROVE' } }) },
    ]
  }

  const all = () => [...ownerOnlyCalls(), ...ownerOrStaffCalls(), ...ownerOrAdminCalls()]

  test('another organizer is refused everywhere', async () => {
    const stranger = await createFreshOrganizer()
    for (const call of all()) expect((await call.send(stranger.api)).status(), call.name).toBe(403)
    await stranger.api.dispose()
  })

  test("a delegate — even one of this MUN's own — is refused everywhere", async () => {
    for (const call of all()) expect((await call.send(alpha.session.api)).status(), call.name).toBe(403)
  })

  test('a signed-out caller is refused everywhere', async () => {
    const anon = await anonApi()
    for (const call of all()) expect((await call.send(anon)).status(), call.name).toBe(401)
    await anon.dispose()
  })

  test('platform staff cannot read delegate records, export them or message delegates', async () => {
    for (const call of ownerOnlyCalls()) expect((await call.send(adminApi)).status(), call.name).toBe(403)
    await expectNoEmail(alpha.session.email, `${OPS.name}: Intruder ${tag}`, 500)
  })

  test("an organizer can't reach another MUN's registration through their own MUN", async () => {
    const outsider = await signUpViaApi({ name: `E2E Ops Stray ${tag}` })
    const strayReg = await registerOnOpenMun(outsider, { pay: true })
    expect((await api.get(`organizer/muns/${munId}/delegates/${strayReg}`)).status()).toBe(404)
    const attendance = await api.put(`organizer/muns/${munId}/delegates/${strayReg}/attendance`, {
      data: { status: 'ATTENDED' },
    })
    expect([404, 409]).toContain(attendance.status())
    expect((await (await outsider.api.get(`registrations/${strayReg}`)).json()).status).toBe('CONFIRMED')
    await outsider.api.dispose()
  })
})
