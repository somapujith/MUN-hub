import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import postgres from 'postgres'
import { DATABASE_URL, assertLocalDatabase } from '../../env'
import { getMun, signUpOrganizerViaApi, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { CLOSED, LIFECYCLE } from '../../fixtures/fixture-muns'
import { watchForCrashes } from '../../fixtures/ui'
import { anonApi, main, openSection, organizerApi, ownedMunBySlug, toast } from './_helpers'

/**
 * Registration & conference lifecycle (1c623f1, cc30a29, a20d7a9):
 * POST/GET /muns/:munId/lifecycle and the "Registration & lifecycle" card on
 * the organizer settings page. Walks the dedicated e2e-lifecycle-mun through
 * open → close → cancel, in order.
 */

test.describe.configure({ mode: 'serial' })

interface LifecycleOverview {
  munId: string
  name: string
  status: string
  confirmedRegistrations: number
  actions: Array<{ action: string; targetStatus: string; available: boolean; blockedReason: string | null; requiresReason: boolean }>
}

let api: APIRequestContext
let munId: string
let delegate: ApiSession
let confirmedRegistrationId: string

async function resetToPublished(slug: string) {
  // prepare-db resets this every run; do it here too so a skip-prepare rerun starts clean.
  assertLocalDatabase()
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
  try {
    await sql.begin(async (tx) => {
      const [mun] = await tx<{ id: string }[]>`update muns set status = 'PUBLISHED' where slug = ${slug} returning id`
      await tx`delete from payments where registration_id in (select id from registrations where mun_id = ${mun.id})`
      await tx`update support_tickets set related_registration_id = null
        where related_registration_id in (select id from registrations where mun_id = ${mun.id})`
      await tx`delete from registrations where mun_id = ${mun.id}`
    })
  } finally {
    await sql.end()
  }
}

async function overview(context = api, id = munId): Promise<LifecycleOverview> {
  const res = await context.get(`muns/${id}/lifecycle`)
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}

function lifecycleCard(page: Page) {
  return main(page).locator('[data-slot="card"]').filter({ hasText: 'Registration & lifecycle' })
}

async function openSettings(page: Page) {
  await openSection(page, munId, 'settings', 'Settings')
  await expect(lifecycleCard(page)).toBeVisible()
}

async function runAction(page: Page, button: string, dialogTitle: string, confirm: string, success: string) {
  await lifecycleCard(page).getByRole('button', { name: button, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: dialogTitle })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: confirm, exact: true }).click()
  await expect(toast(page, success)).toBeVisible()
  await expect(dialog).toBeHidden()
}

test.beforeAll(async () => {
  await resetToPublished(LIFECYCLE.slug)
  api = await organizerApi()
  munId = (await ownedMunBySlug(api, LIFECYCLE.slug)).id
})

test.afterAll(async () => {
  await api?.dispose()
  await delegate?.api.dispose()
})

test('only the owner and staff can see or drive the lifecycle', async () => {
  const anon = await anonApi()
  expect((await anon.get(`muns/${munId}/lifecycle`)).status()).toBe(401)
  expect((await anon.post(`muns/${munId}/lifecycle/open-registration`)).status()).toBe(401)
  await anon.dispose()

  const student = await signUpViaApi()
  expect((await student.api.get(`muns/${munId}/lifecycle`)).status()).toBe(403)
  expect((await student.api.post(`muns/${munId}/lifecycle/open-registration`)).status()).toBe(403)
  await student.api.dispose()

  const stranger = await signUpOrganizerViaApi()
  expect((await stranger.api.get(`muns/${munId}/lifecycle`)).status()).toBe(403)
  expect((await stranger.api.post(`muns/${munId}/lifecycle/cancel`, { data: { reason: 'Not mine' } })).status()).toBe(403)
  await stranger.api.dispose()

  expect((await overview()).status).toBe('PUBLISHED')
})

test('bad requests are refused without changing anything', async () => {
  expect((await api.post(`muns/${munId}/lifecycle/teleport`)).status()).toBe(400)
  expect((await api.post(`muns/${munId}/lifecycle/cancel`)).status()).toBe(400)
  expect((await api.post(`muns/${munId}/lifecycle/cancel`, { data: { reason: '   ' } })).status()).toBe(400)
  expect((await api.post(`muns/${munId}/lifecycle/cancel`, { data: { reason: 'x'.repeat(1001) } })).status()).toBe(400)
  // Archiving is staff-only.
  expect((await api.post(`muns/${munId}/lifecycle/archive`)).status()).toBe(403)
  // Registration isn't open yet, so it can't be closed.
  const close = await api.post(`muns/${munId}/lifecycle/close-registration`)
  expect(close.status()).toBe(409)
  expect((await close.json()).error.message).toMatch(/Registration is not open/)
  expect((await overview()).status).toBe('PUBLISHED')
})

test('a live MUN offers "open registration"; the options match its state', async () => {
  const state = await overview()
  const byAction = Object.fromEntries(state.actions.map((a) => [a.action, a]))
  expect(byAction['open-registration']).toMatchObject({ available: true, blockedReason: null, targetStatus: 'REGISTRATION_OPEN' })
  expect(byAction.cancel).toMatchObject({ requiresReason: true })
  expect(byAction['close-registration']).toBeUndefined()
  expect(byAction.archive).toBeUndefined()
})

test('a paid pass without a verified payment account blocks opening, with the reason', async () => {
  const closedId = (await ownedMunBySlug(api, CLOSED.slug)).id
  const state = await overview(api, closedId)
  const open = state.actions.find((a) => a.action === 'open-registration')
  expect(open).toMatchObject({ available: false })
  expect(open?.blockedReason).toMatch(/payment account|registration deadline|registration pass/i)
  const res = await api.post(`muns/${closedId}/lifecycle/open-registration`)
  expect(res.status()).toBe(409)
  expect((await res.json()).error.message).toBe(open?.blockedReason)
  expect((await overview(api, closedId)).status).toBe('PUBLISHED')
})

test('the organizer opens registration from Settings', async ({ page }) => {
  const crashes = watchForCrashes(page)
  await openSettings(page)
  const card = lifecycleCard(page)
  await expect(card).toContainText('Live')
  for (const label of ['Registration opens', 'Registration deadline', 'Conference starts', 'Conference ends']) {
    await expect(card.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(card.getByRole('link', { name: 'Change dates in Setup' })).toHaveAttribute(
    'href',
    `/organizer/dashboard/${munId}/setup`,
  )

  // "Not now" leaves everything as it was.
  await card.getByRole('button', { name: 'Open registration', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Open registration?' })
  await expect(dialog).toContainText('Registration closes automatically after the deadline')
  await dialog.getByRole('button', { name: 'Not now' }).click()
  await expect(dialog).toBeHidden()
  expect((await overview()).status).toBe('PUBLISHED')

  await runAction(page, 'Open registration', 'Open registration?', 'Open registration', 'Registration is open')
  await expect(card).toContainText('Registration open')
  await expect(card.getByRole('button', { name: 'Close registration', exact: true })).toBeEnabled()
  // The conference is weeks away, so it can't be started yet — and the card says why.
  const start = card.getByRole('button', { name: 'Start conference', exact: true })
  await expect(start).toBeDisabled()
  await expect(card).toContainText(/The conference can be started from/)
  expect((await overview()).status).toBe('REGISTRATION_OPEN')
  crashes.assertNone()
})

test('delegates can register while registration is open', async () => {
  delegate = await signUpViaApi({ name: 'E2E Lifecycle Delegate' })
  const mun = await getMun(delegate.api, LIFECYCLE.slug)
  expect(mun.status).toBe('REGISTRATION_OPEN')
  const res = await delegate.api.post('registrations', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: { munId: mun.id, registrationProductId: mun.registrationProducts[0].id },
  })
  expect(res.status(), await res.text()).toBe(201)
  confirmedRegistrationId = ((await res.json()) as { registrationId: string }).registrationId
  const paid = await delegate.api.post(`registrations/${confirmedRegistrationId}/mock-payment`, { data: { outcome: 'success' } })
  expect(paid.ok(), await paid.text()).toBe(true)
  const reg = await delegate.api.get(`registrations/${confirmedRegistrationId}`)
  expect((await reg.json()).status).toBe('CONFIRMED')
  expect((await overview()).confirmedRegistrations).toBe(1)
})

test('opening twice is refused', async () => {
  const again = await api.post(`muns/${munId}/lifecycle/open-registration`)
  expect(again.status()).toBe(409)
  expect((await again.json()).error.message).toMatch(/Registration can only be opened|already open/)
})

test('closing registration stops new registrations', async ({ page }) => {
  await openSettings(page)
  await runAction(page, 'Close registration', 'Close registration?', 'Close registration', 'Registration is closed')
  await expect(lifecycleCard(page)).toContainText('Registration closed')
  await expect(lifecycleCard(page).getByRole('button', { name: 'Open registration', exact: true })).toHaveCount(0)
  expect((await overview()).status).toBe('REGISTRATION_CLOSED')

  const late = await signUpViaApi()
  const mun = await getMun(late.api, LIFECYCLE.slug)
  const res = await late.api.post('registrations', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: { munId: mun.id, registrationProductId: mun.registrationProducts[0].id },
  })
  expect(res.status()).toBe(409)
  await late.api.dispose()
})

test('cancelling needs a reason and the MUN name, and keeps confirmed delegates', async ({ page }) => {
  await openSettings(page)
  const card = lifecycleCard(page)
  await expect(card).toContainText('MUNHub does not issue refunds')
  await card.getByRole('button', { name: 'Cancel conference' }).click()

  const dialog = page.getByRole('dialog', { name: `Cancel ${LIFECYCLE.name}?` })
  await expect(dialog).toContainText('1 confirmed delegate keeps their registration.')
  await expect(dialog).toContainText('MUNHub does not issue refunds')
  const submit = dialog.getByRole('button', { name: 'Cancel conference' })
  await expect(submit).toBeDisabled()

  await dialog.getByLabel('Reason').fill('The venue fell through.')
  await expect(submit).toBeDisabled()
  await dialog.getByLabel(/to confirm/).fill('E2E Lifecycle')
  await expect(submit).toBeDisabled()

  // "Keep conference" backs out.
  await dialog.getByRole('button', { name: 'Keep conference' }).click()
  await expect(dialog).toBeHidden()
  expect((await overview()).status).toBe('REGISTRATION_CLOSED')

  await card.getByRole('button', { name: 'Cancel conference' }).click()
  await dialog.getByLabel('Reason').fill('The venue fell through.')
  await dialog.getByLabel(/to confirm/).fill(LIFECYCLE.name)
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(toast(page, 'The conference is cancelled')).toBeVisible()
  await expect(card).toContainText('Cancelled')
  await expect(card.getByRole('button', { name: 'Cancel conference' })).toHaveCount(0)

  expect((await overview()).status).toBe('CANCELLED')
  // No refunds: the paid seat stays confirmed.
  const reg = await delegate.api.get(`registrations/${confirmedRegistrationId}`)
  expect((await reg.json()).status).toBe('CONFIRMED')
})

test('a cancelled conference cannot be reopened, and is no longer open to the public', async () => {
  for (const action of ['open-registration', 'close-registration', 'start-conference', 'cancel']) {
    const res = await api.post(`muns/${munId}/lifecycle/${action}`, { data: { reason: 'Try again' } })
    expect(res.status(), action).toBe(409)
  }
  const anon = await anonApi()
  const detail = await anon.get(`muns/${LIFECYCLE.slug}`)
  if (detail.ok()) expect((await detail.json()).status).not.toBe('REGISTRATION_OPEN')
  else expect(detail.status()).toBe(404)
  await anon.dispose()
})
