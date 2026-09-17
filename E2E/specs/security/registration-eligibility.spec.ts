import { expect, test, type APIResponse } from '@playwright/test'
import postgres from 'postgres'
import { DATABASE_URL, assertLocalDatabase } from '../../env'
import { DEMO_PASSWORD, MUNS } from '../../fixtures/accounts'
import { browserContextFor, getMun, signInViaApi, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { CLOSED, FIXTURE_MUNS, OPEN } from '../../fixtures/fixture-muns'

/**
 * PRD §22, §35, §37: registration eligibility must be enforced by the
 * server, not just hidden in the UI. The UI never offers any of these; each
 * test goes straight at the API the way a scripted client would.
 *
 * Enforced in lib/actions/registration.ts#initiateRegistration (inside the
 * locked transaction) and, for the profile gate, server/routes/registrations.ts.
 */

function register(session: ApiSession, body: Record<string, unknown>) {
  return session.api.post('registrations', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: body,
  })
}

/** A deliberate refusal: a 4xx with a readable message, never a 500. */
async function expectRefused(res: APIResponse, status?: number) {
  const text = await res.text()
  expect(res.status(), text).toBeGreaterThanOrEqual(400)
  expect(res.status(), text).toBeLessThan(500)
  if (status) expect(res.status(), text).toBe(status)
  const body = JSON.parse(text) as { error?: { message?: string } }
  expect(body.error?.message, text).toBeTruthy()
}

/** Signup always saves a full profile, so remove it to get an incomplete one. */
async function signUpWithoutProfile(): Promise<ApiSession> {
  const delegate = await signUpViaApi()
  assertLocalDatabase()
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
  try {
    await sql`delete from student_profiles where user_id = ${delegate.userId}`
  } finally {
    await sql.end()
  }
  return delegate
}

test('the registration page sends a student with an incomplete profile to finish it', async ({ browser }) => {
  const delegate = await signUpWithoutProfile()
  const context = await browserContextFor(browser, delegate)
  const page = await context.newPage()
  await page.goto(`/register/${OPEN.slug}`)
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: 'Complete your profile first' })).toBeVisible()
  await expect(main.getByRole('button', { name: /continue to details/i })).toHaveCount(0)
  await main.getByRole('button', { name: 'Complete your profile' }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await context.close()
})

test('a student with an incomplete profile is told to finish it before registering', async () => {
  const delegate = await signUpWithoutProfile()
  const open = await getMun(delegate.api, OPEN.slug)
  const pass = open.registrationProducts.find((p) => p.name === OPEN.products[0].name)!
  const res = await register(delegate, { munId: open.id, registrationProductId: pass.id })
  await expectRefused(res, 409)
  expect((await res.json()).error.message).toMatch(/complete your profile/i)
})

test('a MUN that is published but not open for registration refuses registrations', async () => {
  const delegate = await signUpViaApi()
  const mun = await getMun(delegate.api, CLOSED.slug)
  expect(mun.status).not.toBe('REGISTRATION_OPEN')
  const pass = mun.registrationProducts[0]

  const res = await register(delegate, { munId: mun.id, registrationProductId: pass.id })
  await expectRefused(res)
})

test('a seeded MUN whose registration has not opened refuses registrations', async () => {
  const delegate = await signUpViaApi()
  const mun = await getMun(delegate.api, MUNS.open.slug) // Oxford MUN 2027 — not open yet
  const res = await register(delegate, { munId: mun.id, registrationProductId: mun.registrationProducts[0].id })
  await expectRefused(res)
})

test('an inactive (retired) pass cannot be bought', async () => {
  // The public API hides inactive passes, so read the id the way the owning organizer sees it.
  const owner = await signInViaApi(FIXTURE_MUNS.ownerEmail, DEMO_PASSWORD)
  const openMun = await getMun(owner.api, OPEN.slug)
  const productsRes = await owner.api.get(`muns/${OPEN.slug}/products?includeInactive=true`)
  expect(productsRes.ok()).toBe(true)
  const all = (await productsRes.json()) as Array<{ id: string; name: string; status: string }>
  const retired = all.find((p) => p.name === OPEN.products[2].name)
  expect(retired?.status).toBe('inactive')

  const delegate = await signUpViaApi()
  const res = await register(delegate, { munId: openMun.id, registrationProductId: retired!.id })
  await expectRefused(res)
})

test('a pass from one MUN cannot be registered against another MUN', async () => {
  const delegate = await signUpViaApi()
  const open = await getMun(delegate.api, OPEN.slug)
  const closed = await getMun(delegate.api, CLOSED.slug)

  // Claim the open MUN, but buy the closed MUN's pass.
  const res = await register(delegate, {
    munId: open.id,
    registrationProductId: closed.registrationProducts[0].id,
  })
  await expectRefused(res)
})

test("a committee or portfolio from a different MUN is refused", async () => {
  const delegate = await signUpViaApi()
  const open = await getMun(delegate.api, OPEN.slug)
  const oxford = await getMun(delegate.api, MUNS.open.slug)
  const foreignCommittee = oxford.committees[0]

  const res = await register(delegate, {
    munId: open.id,
    registrationProductId: open.registrationProducts[0].id,
    committeeId: foreignCommittee.id,
    portfolioId: foreignCommittee.portfolios[0].id,
  })
  await expectRefused(res)
})

test('a portfolio must belong to the chosen committee', async () => {
  const delegate = await signUpViaApi()
  const open = await getMun(delegate.api, OPEN.slug)
  const ga = open.committees.find((c) => c.name === OPEN.committees[0].name)!
  const sc = open.committees.find((c) => c.name === OPEN.committees[1].name)!

  const res = await register(delegate, {
    munId: open.id,
    registrationProductId: open.registrationProducts[0].id,
    committeeId: ga.id,
    portfolioId: sc.portfolios[0].id,
  })
  await expectRefused(res)
})

test('committee capacity is enforced', async () => {
  const probe = await signUpViaApi()
  const open = await getMun(probe.api, OPEN.slug)
  // "E2E Security Council" has capacity 2 and is reserved for this test.
  const sc = open.committees.find((c) => c.name === OPEN.committees[1].name)!
  const pass = open.registrationProducts.find((p) => p.name === OPEN.products[0].name)!

  const statuses: number[] = []
  for (let i = 0; i < 4; i += 1) {
    const delegate = await signUpViaApi()
    statuses.push((await register(delegate, { munId: open.id, registrationProductId: pass.id, committeeId: sc.id })).status())
  }
  // However many seats earlier runs already used, a capacity-2 committee can never accept 3+.
  expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(2)
  expect(statuses.some((s) => s === 409)).toBe(true)
  expect(statuses.every((s) => s === 201 || s === 409), statuses.join(',')).toBe(true)
})
