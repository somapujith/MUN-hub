import { expect, test } from '@playwright/test'
import { newApiContext, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { OPEN } from '../../fixtures/fixture-muns'
import { freshStudentPage, main, registerOnOpenMun } from './_helpers'

/**
 * PRD §33: participant data is private. Public marketplace reads never carry
 * it, and one student can never read another's registration or profile.
 */

test.use({ storageState: { cookies: [], origins: [] } })

const PRIVATE_KEYS = [
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'dateOfBirth',
  'residentialAddress',
  'passwordHash',
  'formResponses',
  'munExperience',
  'referralCode',
]

function randomPhone() {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`
}

/** A registered student whose private details are all unique, so any leak is attributable. */
async function registeredStudentWithUniqueDetails() {
  const marker = crypto.randomUUID().slice(0, 8)
  const details = {
    phone: randomPhone(),
    emergencyContactName: `E2E Secret Guardian ${marker}`,
    emergencyContactPhone: randomPhone(),
    residentialAddress: `${marker} Private Street, Hyderabad`,
    dateOfBirth: '2003-02-11',
  }
  const session = await signUpViaApi(details)
  // Committee only: each portfolio seats one delegate, and this helper runs
  // several times per test run.
  const registrationId = await registerOnOpenMun(session, {
    committee: OPEN.committees[0].name,
    pay: true,
  })
  return { session, registrationId, details }
}

function expectNoPrivateData(json: unknown, students: Array<{ session: ApiSession; details: Record<string, string> }>) {
  const body = JSON.stringify(json)
  for (const key of PRIVATE_KEYS) expect(body, `public payload contains "${key}"`).not.toContain(`"${key}"`)
  for (const { session, details } of students) {
    expect(body).not.toContain(session.email)
    expect(body).not.toContain(session.userId)
    for (const value of Object.values(details)) expect(body).not.toContain(value)
  }
}

test.describe('privacy — public marketplace', () => {
  test('marketplace and MUN detail JSON carry no participant data', async () => {
    const students = [await registeredStudentWithUniqueDetails(), await registeredStudentWithUniqueDetails()]

    const anon = await newApiContext()
    const list = await anon.get(`muns?query=${encodeURIComponent(OPEN.name)}`)
    expect(list.ok()).toBeTruthy()
    const listJson = await list.json()
    expect(JSON.stringify(listJson)).toContain(OPEN.slug)
    expectNoPrivateData(listJson, students)

    const full = await anon.get('muns?limit=100')
    expectNoPrivateData(await full.json(), students)

    const detail = await anon.get(`muns/${OPEN.slug}`)
    expect(detail.ok()).toBeTruthy()
    const detailJson = await detail.json()
    expectNoPrivateData(detailJson, students)

    const committees = await anon.get(`muns/${detailJson.id}/committees`)
    expectNoPrivateData(await committees.json(), students)

    const productIds = (detailJson.registrationProducts as Array<{ id: string }>).map((p) => p.id).join(',')
    const availability = await anon.get(`products/availability?ids=${productIds}`)
    expectNoPrivateData(await availability.json(), students)
    await anon.dispose()
  })

  test('a signed-in student sees no other participant data in public JSON either', async () => {
    const other = await registeredStudentWithUniqueDetails()
    const viewer = await signUpViaApi()
    const detail = await viewer.api.get(`muns/${OPEN.slug}`)
    expectNoPrivateData(await detail.json(), [other])
  })

  test('the MUN page itself shows no participant data', async ({ browser }) => {
    const other = await registeredStudentWithUniqueDetails()
    const { context, page } = await freshStudentPage(browser)
    await page.goto(`/mun/${OPEN.slug}`)
    await expect(page.getByRole('heading', { level: 1, name: OPEN.name })).toBeVisible()
    for (const value of [other.session.email, other.details.emergencyContactName, other.details.phone]) {
      await expect(main(page)).not.toContainText(value)
    }
    await context.close()
  })
})

test.describe('privacy — other students\' records', () => {
  test('a student cannot read or pay for another student\'s registration', async ({ browser }) => {
    const owner = await registeredStudentWithUniqueDetails()
    const snoop = await signUpViaApi()

    const own = await owner.session.api.get(`registrations/${owner.registrationId}`)
    expect(own.status()).toBe(200)
    expect((await own.json()).userId).toBe(owner.session.userId)

    const read = await snoop.api.get(`registrations/${owner.registrationId}`)
    expect([403, 404]).toContain(read.status())
    expect(await read.text()).not.toContain(owner.session.userId)

    const pay = await snoop.api.post(`registrations/${owner.registrationId}/mock-payment`, { data: { outcome: 'failure' } })
    expect([403, 404]).toContain(pay.status())
    // The owner's confirmed seat is untouched.
    expect((await (await owner.session.api.get(`registrations/${owner.registrationId}`)).json()).status).toBe('CONFIRMED')

    // Nor through the confirmation page.
    const context = await browser.newContext({ storageState: await snoop.api.storageState() })
    const page = await context.newPage()
    await page.goto(`/register/${OPEN.slug}/confirmation?registrationId=${owner.registrationId}`)
    // The page renders "Page not found" for a registration the viewer can't read.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/not found/i)
    await expect(page.locator('body')).not.toContainText(OPEN.committees[0].name)
    await expect(page.locator('body')).not.toContainText(/you're registered/i)
    await context.close()
  })

  test('an unknown registration id is simply not found', async () => {
    const student = await signUpViaApi()
    const res = await student.api.get(`registrations/${crypto.randomUUID()}`)
    expect(res.status()).toBe(404)
  })

  test('the dashboard lists only the caller\'s own registrations', async () => {
    const owner = await registeredStudentWithUniqueDetails()
    const viewer = await signUpViaApi()
    const upcoming = await (await viewer.api.get('me/registrations/upcoming')).json()
    expect(upcoming).toEqual([])
    const past = await (await viewer.api.get('me/registrations/past')).json()
    expect(JSON.stringify(past)).not.toContain(owner.registrationId)
  })

  test('profile and account reads only ever return the caller\'s own data', async () => {
    const a = await registeredStudentWithUniqueDetails()
    const b = await registeredStudentWithUniqueDetails()

    for (const [me, them] of [
      [a, b],
      [b, a],
    ] as const) {
      const profile = await (await me.session.api.get('profile')).json()
      expect(profile.userId).toBe(me.session.userId)
      expect(profile.emergencyContactName).toBe(me.details.emergencyContactName)
      expect(JSON.stringify(profile)).not.toContain(them.details.emergencyContactName)

      const account = await (await me.session.api.get('account')).json()
      expect(account.email).toBe(me.session.email)
    }

    // There is no way to address someone else's profile: extra params are ignored.
    const probe = await a.session.api.get(`profile?userId=${b.session.userId}`)
    if (probe.ok()) expect((await probe.json()).userId).toBe(a.session.userId)
  })

  test('a student cannot overwrite another student\'s profile', async () => {
    const a = await registeredStudentWithUniqueDetails()
    const b = await registeredStudentWithUniqueDetails()
    const res = await a.session.api.put('profile', {
      data: {
        userId: b.session.userId,
        phone: '9000000000',
        institution: 'Hijack U',
        dateOfBirth: '2000-01-01',
        gradeOrYear: 'x',
        residentialAddress: 'x',
        requiresTransportation: false,
        emergencyContactName: 'Hijacker',
        emergencyContactPhone: '9000000001',
        emergencyContactRelation: 'x',
      },
    })
    // The strict body schema rejects a userId outright.
    expect(res.status()).toBe(400)
    const bProfile = await (await b.session.api.get('profile')).json()
    expect(bProfile.emergencyContactName).toBe(b.details.emergencyContactName)
  })

  test('signed-out callers get nothing from private endpoints', async () => {
    const owner = await registeredStudentWithUniqueDetails()
    const anon = await newApiContext()
    for (const path of ['profile', 'account', `registrations/${owner.registrationId}`, 'support/conversations']) {
      const res = await anon.get(path)
      expect(res.status(), path).toBe(401)
    }
    await anon.dispose()
  })
})
