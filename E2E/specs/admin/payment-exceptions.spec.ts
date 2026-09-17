import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { browserContextFor, getMun, newApiContext, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { OPEN } from '../../fixtures/fixture-muns'
import { expireSeatHold, paymentFor, registrationStatus } from '../../fixtures/payments-fixture-db'
import { watchForCrashes } from '../../fixtures/ui'
import { adminApi, fixtureOwnerApi, heading, main, tableRow, toast, uniqueName } from './_helpers'

/**
 * A payment that lands after the delegate's 15-minute seat hold ran out
 * (lane `payments`). There are no refunds: the registration stays
 * cancelled, the payment is recorded as PAID with a payment exception, and
 * an admin resolves it with a note after returning the money off-platform.
 *
 * The hold is aged in the local database (fixtures/payments-fixture-db.ts)
 * instead of waiting 15 minutes.
 */

const DELEGATE_PASS = OPEN.products[0] // ₹1,499

async function heldSeat(): Promise<{ delegate: ApiSession; name: string; registrationId: string; productId: string }> {
  const name = uniqueName('E2E Late Payer')
  const delegate = await signUpViaApi({ name })
  const mun = await getMun(delegate.api, OPEN.slug)
  const pass = mun.registrationProducts.find((p) => p.name === DELEGATE_PASS.name)!
  const res = await delegate.api.post('registrations', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { munId: mun.id, registrationProductId: pass.id },
  })
  expect(res.status(), await res.text()).toBe(201)
  const { registrationId } = (await res.json()) as { registrationId: string }
  return { delegate, name, registrationId, productId: pass.id }
}

/** Any availability read sweeps expired holds on that pass, as production does. */
async function sweepExpiredHolds(productId: string) {
  const anon = await newApiContext()
  expect((await anon.get(`products/availability?ids=${productId}`)).status()).toBe(200)
  await anon.dispose()
}

function exceptionRow(page: Page, registrationId: string) {
  return tableRow(page, registrationId)
}

async function openExceptions(page: Page) {
  await page.goto('/admin/payments')
  await expect(heading(page, 'Payments')).toBeVisible()
  await expect(main(page)).toContainText('There are no refunds')
}

async function resolveViaApi(api: APIRequestContext, paymentId: string, note: unknown) {
  return api.post(`admin/payment-exceptions/${paymentId}/resolve`, { data: { note } })
}

test.describe('late payments', () => {
  test('a delegate who pays after the hold lapsed is not registered; an admin resolves the exception with a note', async ({ page, browser }) => {
    const crashes = watchForCrashes(page)
    const { delegate, name, registrationId, productId } = await heldSeat()

    // The delegate is on the checkout page when the hold runs out.
    const delegateContext = await browserContextFor(browser, delegate)
    const checkout = await delegateContext.newPage()
    await checkout.goto(`/register/${OPEN.slug}/pay?registrationId=${registrationId}`)
    const pay = checkout.getByRole('main').getByRole('button', { name: /^pay /i })
    await expect(pay).toBeVisible()

    await expireSeatHold(registrationId)
    await sweepExpiredHolds(productId)
    expect(await registrationStatus(registrationId)).toBe('CANCELLED')

    const paid = checkout.waitForResponse((r) => r.url().endsWith(`/registrations/${registrationId}/mock-payment`))
    await pay.click()
    const response = await paid
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ ok: true, exception: true })
    await expect(checkout).toHaveURL(/\/confirmation\?registrationId=/)
    await expect(checkout.getByRole('main')).toContainText('Payment received after your seat hold ended')
    await expect(checkout.getByRole('main')).not.toContainText(/you're registered|didn't go through/i)
    await expect(checkout.getByRole('main')).not.toContainText(/refund/i)

    // Not confirmed, money recorded as taken, never a refund.
    expect(await registrationStatus(registrationId)).toBe('CANCELLED')
    const payment = await paymentFor(registrationId)
    expect(payment).toMatchObject({
      status: 'PAID',
      amount: DELEGATE_PASS.price,
      exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED',
      exceptionResolvedAt: null,
    })
    const detail = await (await delegate.api.get(`registrations/${registrationId}`)).json()
    expect(detail.status).toBe('CANCELLED')
    expect(detail.payment).toEqual([{ amount: DELEGATE_PASS.price, currency: 'INR', status: 'PAID' }])

    // The admin queue lists it.
    await openExceptions(page)
    const row = exceptionRow(page, registrationId)
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(name)
    await expect(row).toContainText(delegate.email)
    await expect(row).toContainText(OPEN.name)
    await expect(row).toContainText('₹1,499')
    await expect(row).toContainText('Paid after hold expired')
    await expect(row).toContainText(payment!.providerPaymentId!)

    // A note is required, in the dialog and in the API.
    await row.getByRole('button', { name: `Resolve exception for ${name}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Resolve payment exception' })
    await expect(dialog).toContainText('Return the full amount.')
    await expect(dialog).toContainText(name)
    await expect(dialog).toContainText('₹1,499')
    const submit = dialog.getByRole('button', { name: 'Mark resolved' })
    await expect(submit).toBeDisabled()
    await dialog.getByLabel('Resolution note').fill('   ')
    await expect(submit).toBeDisabled()

    const admin = await adminApi()
    for (const note of ['', '   ', 'n'.repeat(2001), undefined]) {
      const res = await resolveViaApi(admin, payment!.id, note)
      expect(res.status(), `note ${JSON.stringify(note)?.slice(0, 10)}`).toBe(400)
    }
    expect((await paymentFor(registrationId))!.exceptionResolvedAt).toBeNull()

    const note = `Returned ₹1,499 to the original method, ref E2E-${Date.now()}`
    await dialog.getByLabel('Resolution note').fill(note)
    await submit.click()
    await expect(toast(page, 'Payment exception resolved')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(exceptionRow(page, registrationId)).toHaveCount(0)

    const resolved = await paymentFor(registrationId)
    expect(resolved).toMatchObject({ status: 'PAID', exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED', exceptionResolutionNote: note })
    expect(resolved!.exceptionResolvedAt).not.toBeNull()
    expect(await registrationStatus(registrationId)).toBe('CANCELLED')

    // Resolving twice is a conflict; the resolution is in the audit trail.
    expect((await resolveViaApi(admin, payment!.id, 'again')).status()).toBe(409)
    const history = (await (await admin.get(`admin/audit/payment/${payment!.id}`)).json()) as Array<{ action: string; reason: string | null }>
    expect(history).toEqual([expect.objectContaining({ action: 'PAYMENT_DETAILS_CHANGED', reason: note })])
    await admin.dispose()
    await delegateContext.close()
    crashes.assertNone()
  })

  test('the confirmation page tells a late payer their money arrived after the hold ended', async ({ browser }) => {
    const { delegate, registrationId, productId } = await heldSeat()
    await expireSeatHold(registrationId)
    await sweepExpiredHolds(productId)
    const pay = await delegate.api.post(`registrations/${registrationId}/mock-payment`, { data: { outcome: 'success' } })
    expect(await pay.json()).toEqual({ ok: true, exception: true })

    const context = await browserContextFor(browser, delegate)
    const page = await context.newPage()
    await page.goto(`/register/${OPEN.slug}/confirmation?registrationId=${registrationId}`)
    const notice = page.getByRole('main')
    await expect(notice).toContainText('Payment received after your seat hold ended')
    await expect(notice).toContainText('₹1,499')
    await expect(notice).not.toContainText("Payment didn't go through")
    await expect(notice).not.toContainText('Your seat hold expired')
    await notice.getByRole('button', { name: 'Contact support' }).click()
    await expect(page).toHaveURL(/\/support\/new$/)
    await context.close()
    await resolveOpenException(registrationId)
  })

  test('the confirmation page tells a failed payment and an unpaid lapsed hold apart', async ({ browser }) => {
    const failed = await heldSeat()
    await failed.delegate.api.post(`registrations/${failed.registrationId}/mock-payment`, { data: { outcome: 'failure' } })
    const lapsed = await heldSeat()
    await expireSeatHold(lapsed.registrationId)
    await sweepExpiredHolds(lapsed.productId)
    expect(await registrationStatus(lapsed.registrationId)).toBe('CANCELLED')

    for (const [who, title, other, button] of [
      [failed, "Payment didn't go through", 'Your seat hold expired', 'Try again'],
      [lapsed, 'Your seat hold expired', "Payment didn't go through", 'Start again'],
    ] as const) {
      const context = await browserContextFor(browser, who.delegate)
      const page = await context.newPage()
      await page.goto(`/register/${OPEN.slug}/confirmation?registrationId=${who.registrationId}`)
      const notice = page.getByRole('main')
      await expect(notice).toContainText(title)
      await expect(notice).not.toContainText(other)
      await expect(notice).not.toContainText('Payment received after your seat hold ended')
      await expect(notice).not.toContainText(/refund/i)
      await notice.getByRole('button', { name: button }).click()
      await expect(page).toHaveURL(new RegExp(`/register/${OPEN.slug}$`))
      await context.close()
    }
    expect(await paymentFor(failed.registrationId)).toMatchObject({ status: 'FAILED', exceptionReason: null })
  })

  test('a payment captured after the hold expired is an exception even before any sweep released the seat', async () => {
    const { delegate, registrationId } = await heldSeat()
    await expireSeatHold(registrationId)
    expect(await registrationStatus(registrationId)).toBe('PAYMENT_PENDING')
    const pay = await delegate.api.post(`registrations/${registrationId}/mock-payment`, { data: { outcome: 'success' } })
    expect(await pay.json()).toEqual({ ok: true, exception: true })
    // The webhook released the seat itself.
    expect(await registrationStatus(registrationId)).toBe('CANCELLED')
    expect(await paymentFor(registrationId)).toMatchObject({ status: 'PAID', exceptionReason: 'PAYMENT_AFTER_HOLD_EXPIRED' })
    await resolveOpenException(registrationId)
  })

  test('a lapsed, unpaid hold shows as expired on the checkout page with no way to pay', async ({ browser }) => {
    const { delegate, registrationId } = await heldSeat()
    await expireSeatHold(registrationId)
    const context = await browserContextFor(browser, delegate)
    const page = await context.newPage()
    await page.goto(`/register/${OPEN.slug}/pay?registrationId=${registrationId}`)
    await expect(page.getByRole('main')).toContainText('Your seat hold expired')
    await expect(page.getByRole('main').getByRole('button', { name: /^pay /i })).toHaveCount(0)
    await page.getByRole('main').getByRole('button', { name: 'Start over' }).click()
    await expect(page).toHaveURL(new RegExp(`/register/${OPEN.slug}$`))
    await context.close()
  })
})

test.describe('payment exception access', () => {
  test('only staff can list or resolve payment exceptions; unknown ids are 404', async () => {
    const delegate = await signUpViaApi()
    const owner = await fixtureOwnerApi()
    for (const api of [delegate.api, owner]) {
      expect((await api.get('admin/payment-exceptions')).status()).toBe(403)
      expect((await resolveViaApi(api, randomUUID(), 'mine now')).status()).toBe(403)
    }
    const anon = await newApiContext()
    expect((await anon.get('admin/payment-exceptions')).status()).toBe(401)
    await anon.dispose()
    await owner.dispose()

    const admin = await adminApi()
    expect((await resolveViaApi(admin, randomUUID(), 'no such payment')).status()).toBe(404)
    // A confirmed, paid registration has no exception to resolve.
    const { delegate: payer, registrationId } = await heldSeat()
    await payer.api.post(`registrations/${registrationId}/mock-payment`, { data: { outcome: 'success' } })
    const payment = await paymentFor(registrationId)
    expect(payment).toMatchObject({ status: 'PAID', exceptionReason: null })
    expect((await resolveViaApi(admin, payment!.id, 'nothing to do')).status()).toBe(404)
    expect((await admin.post(`admin/payment-exceptions/${payment!.id}/resolve`, { data: { note: 'x', refund: true } })).status()).toBe(400)
    await admin.dispose()
  })
})

/** Resolves a registration's open payment exception, so the admin queue stays short. */
async function resolveOpenException(registrationId: string) {
  const payment = await paymentFor(registrationId)
  const admin = await adminApi()
  const res = await resolveViaApi(admin, payment!.id, 'Returned (E2E cleanup)')
  expect(res.status(), await res.text()).toBe(200)
  await admin.dispose()
}
