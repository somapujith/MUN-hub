import { expect, test } from '@playwright/test'
import { WEB_URL } from '../../env'
import { newApiContext, signUpViaApi } from '../../fixtures/api'
import { uniqueEmail } from '../../fixtures/data'
import { expectNoEmail, linkIn, waitForEmail } from '../../fixtures/outbox'
import { pageHeading, watchForCrashes } from '../../fixtures/ui'

/**
 * Email verification (97e0ce7): POST /verify-email {token},
 * POST /verify-email/resend {email}, and the /verify-email page. Links are
 * read from the API's email outbox (fixtures/outbox.ts).
 */

const SUBJECT = 'Verify your MUN Hub email'
const INVALID = 'This verification link is invalid or has expired'

async function requestLink(email: string) {
  const api = await newApiContext()
  const res = await api.post('verify-email/resend', { data: { email } })
  expect(res.status()).toBe(204)
  await api.dispose()
  const mail = await waitForEmail(email, SUBJECT, { after: new Date(Date.now() - 1_000) })
  const link = linkIn(mail, '/verify-email')
  expect(link.origin).toBe(WEB_URL)
  const token = link.searchParams.get('token')
  expect(token).toMatch(/\S{20,}/)
  return { link, token: token! }
}

test('the emailed link verifies the address, once', async ({ page }) => {
  const crashes = watchForCrashes(page)
  const student = await signUpViaApi()
  const { link, token } = await requestLink(student.email)

  await page.goto(link.pathname + link.search)
  await expect(pageHeading(page)).toHaveText('Email verified')
  await expect(page).toHaveTitle('Verify email | MUN Hub')
  await page.getByRole('main').getByRole('button', { name: /continue to your dashboard/i }).click()
  await expect(page).toHaveURL(/\/(dashboard|login\?redirectTo=%2Fdashboard)$/)

  // The link is single-use.
  const api = await newApiContext()
  const again = await api.post('verify-email', { data: { token } })
  expect(again.status()).toBe(400)
  expect((await again.json()).error).toMatchObject({ code: 'VALIDATION_FAILED', message: INVALID })
  await api.dispose()
  crashes.assertNone()
})

test('a bad link explains itself and offers a fresh one', async ({ page }) => {
  const student = await signUpViaApi()
  await page.goto('/verify-email?token=not-a-real-token')
  await expect(pageHeading(page)).toHaveText('Verification failed')
  await expect(page.getByRole('main').getByRole('alert')).toContainText(INVALID)

  const since = new Date()
  await page.getByRole('main').getByLabel('Email address').fill(student.email)
  await page.getByRole('main').getByRole('button', { name: 'Resend verification email' }).click()
  await expect(page.getByRole('main')).toContainText("If an account exists for that email, we've sent a fresh verification link.")
  const mail = await waitForEmail(student.email, SUBJECT, { after: since })
  expect(linkIn(mail, '/verify-email').searchParams.get('token')).toBeTruthy()
})

test('opening the page without a token shows the resend form', async ({ page }) => {
  await page.goto('/verify-email')
  await expect(pageHeading(page)).toHaveText('Verify your email')
  await expect(page.getByRole('main').getByRole('button', { name: 'Resend verification email' })).toBeVisible()
})

test('a newer link replaces the older one', async () => {
  const student = await signUpViaApi()
  const first = await requestLink(student.email)
  const second = await requestLink(student.email)
  expect(second.token).not.toBe(first.token)

  const api = await newApiContext()
  expect((await api.post('verify-email', { data: { token: first.token } })).status()).toBe(400)
  expect((await api.post('verify-email', { data: { token: second.token } })).status()).toBe(204)
  await api.dispose()
})

test('resending never reveals whether an address has an account', async () => {
  const student = await signUpViaApi()
  const ghost = uniqueEmail('ghost-verify')
  const api = await newApiContext()
  const known = await api.post('verify-email/resend', { data: { email: student.email } })
  const unknown = await api.post('verify-email/resend', { data: { email: ghost } })
  expect(unknown.status()).toBe(known.status())
  expect(await unknown.text()).toBe(await known.text())
  await expectNoEmail(ghost, SUBJECT)
  await api.dispose()
})

test('malformed requests are refused', async () => {
  const api = await newApiContext()
  for (const data of [{}, { token: '' }, { token: 'x', extra: true }]) {
    const res = await api.post('verify-email', { data })
    expect(res.status(), JSON.stringify(data)).toBe(400)
  }
  expect((await api.post('verify-email/resend', { data: { email: 'not-an-email' } })).status()).toBe(400)
  await api.dispose()
})
