import { expect, test } from '@playwright/test'
import { DEMO_PASSWORD, MUNS } from '../../fixtures/accounts'
import { getMun, signInViaApi, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { CLOSED, FIXTURE_MUNS, OPEN } from '../../fixtures/fixture-muns'

/**
 * PRD §22, §35, §37: registration eligibility must be enforced by the
 * server, not just hidden in the UI. The UI never offers any of these; each
 * test goes straight at the API the way a scripted client would.
 *
 * Tests marked `test.fail` document real gaps in
 * lib/actions/registration.ts#initiateRegistration, which today only checks
 * that the pass exists, the caller has no other active seat on it, and the
 * pass has capacity. They assert the CORRECT behavior, so they will start
 * "unexpectedly passing" (and fail the run) once the gap is fixed — at which
 * point delete the `test.fail` line.
 */

function register(session: ApiSession, body: Record<string, unknown>) {
  return session.api.post('registrations', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: body,
  })
}

test('BUG: a MUN that is published but not open for registration refuses registrations', async () => {
  test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, 'BUG: initiateRegistration never checks muns.status === REGISTRATION_OPEN (lib/actions/registration.ts)')
  const delegate = await signUpViaApi()
  const mun = await getMun(delegate.api, CLOSED.slug)
  expect(mun.status).not.toBe('REGISTRATION_OPEN')
  const pass = mun.registrationProducts[0]

  const res = await register(delegate, { munId: mun.id, registrationProductId: pass.id })
  expect(res.status()).toBeGreaterThanOrEqual(400)
})

test('BUG: a seeded MUN whose registration has not opened refuses registrations', async () => {
  test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, 'BUG: initiateRegistration ignores MUN status and registration window')
  const delegate = await signUpViaApi()
  const mun = await getMun(delegate.api, MUNS.open.slug) // Oxford MUN 2027 — not open yet
  const res = await register(delegate, { munId: mun.id, registrationProductId: mun.registrationProducts[0].id })
  expect(res.status()).toBeGreaterThanOrEqual(400)
})

test('BUG: an inactive (retired) pass cannot be bought', async () => {
  test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, "BUG: initiateRegistration never checks registration_products.status === 'active'")
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
  expect(res.status()).toBeGreaterThanOrEqual(400)
})

test('BUG: a pass from one MUN cannot be registered against another MUN', async () => {
  test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, 'BUG: initiateRegistration never checks the pass belongs to input.munId')
  const delegate = await signUpViaApi()
  const open = await getMun(delegate.api, OPEN.slug)
  const closed = await getMun(delegate.api, CLOSED.slug)

  // Claim the open MUN, but buy the closed MUN's pass.
  const res = await register(delegate, {
    munId: open.id,
    registrationProductId: closed.registrationProducts[0].id,
  })
  expect(res.status()).toBeGreaterThanOrEqual(400)
})

test("BUG: a committee or portfolio from a different MUN is refused", async () => {
  test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, 'BUG: initiateRegistration never checks committeeId/portfolioId belong to the MUN')
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
  expect(res.status()).toBeGreaterThanOrEqual(400)
})

test('BUG: a portfolio must belong to the chosen committee', async () => {
  test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, 'BUG: initiateRegistration never checks portfolioId belongs to committeeId')
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
  expect(res.status()).toBeGreaterThanOrEqual(400)
})

test('BUG: committee capacity is enforced', async () => {
  test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, 'BUG: only pass capacity is enforced — committees.capacity is never checked (PRD §22)')
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
  expect(statuses.some((s) => s >= 400)).toBe(true)
})
