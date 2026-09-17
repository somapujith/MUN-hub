import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test'
import { API_ORIGIN, WEB_URL } from '../../env'
import { recreateReadyMun } from '../../fixtures/fixture-db'
import { CONFIRM } from '../../fixtures/fixture-muns'
import { watchForCrashes } from '../../fixtures/ui'
import { STORAGE_STATE } from '../../paths'
import { main, openSection, organizerApi, toast } from './_helpers'

/**
 * The organizer's side of Gate 2 in the UI (87d7102), on e2e-confirm-mun
 * (every go-live module filled in; recreated each run): the go-live checklist,
 * "Run checks and submit", the confirmation step, the review banner on every
 * section, and reviewer feedback after changes are requested. Serial.
 */

test.describe.configure({ mode: 'serial' })

let api: APIRequestContext
let munId: string

async function status(): Promise<string> {
  const res = await api.get(`muns/${munId}/progress`)
  expect(res.status()).toBe(200)
  return (await res.json()).lifecycleStatus
}

async function openSetup(page: Page) {
  await openSection(page, munId, 'setup', 'MUN Setup')
  await expect(main(page).getByRole('heading', { level: 2, name: 'Go-live checklist' })).toBeVisible()
}

function banner(page: Page) {
  return page.getByTestId('review-lock-banner')
}

test.beforeAll(async () => {
  api = await organizerApi()
  // Start from a clean copy every time, so a rerun without prepare-db works.
  munId = await recreateReadyMun(CONFIRM)
})

test.afterAll(async () => {
  await api?.dispose()
})

test('the checklist shows every module, with its state and a link to fix it', async ({ page }) => {
  const crashes = watchForCrashes(page)
  await openSetup(page)
  const progress = await (await api.get(`muns/${munId}/progress`)).json()
  for (const module of progress.modules as Array<{ key: string; label: string }>) {
    const row = page.getByTestId(`module-${module.key}`)
    await expect(row).toContainText(module.label)
    await expect(row).toContainText(/Not started|In progress|Needs work|Complete|Locked for review/)
    await expect(row).toContainText(/Not sent for review|Waiting for MUN Hub|Verified|Changes requested|Rejected/)
  }
  const committees = page.getByTestId('module-COMMITTEES')
  await committees.getByRole('link', { name: 'Open Committees & Portfolios' }).click()
  await expect(page).toHaveURL(new RegExp(`/organizer/dashboard/${munId}/committees$`))
  // Nothing is under review yet, so no banner.
  await expect(banner(page)).toHaveCount(0)
  crashes.assertNone()
})

test('a complete module can be sent for review on its own', async ({ page }) => {
  await openSetup(page)
  const row = page.getByTestId('module-BASIC_INFO')
  await expect(row).toContainText('Complete')
  await row.getByRole('button', { name: 'Send Basic Info for review' }).click()
  await expect(toast(page, 'Basic Info sent to MUN Hub for review')).toBeVisible()
  await expect(row).toContainText('Waiting for MUN Hub')
  await expect(row.getByRole('button', { name: /Send Basic Info/ })).toHaveCount(0)
})

test('"Run checks and submit" passes and asks for confirmation', async ({ page }) => {
  await openSetup(page)
  await main(page).getByRole('button', { name: 'Run checks and submit' }).click()
  await expect(toast(page, 'Automated checks passed. Confirm your submission to send it to MUN Hub.')).toBeVisible()
  expect(await status()).toBe('ORGANIZER_CONFIRMATION')

  const card = main(page).getByRole('heading', { level: 2, name: 'Confirm your submission' })
  await expect(card).toBeVisible()
  const summary = page.getByTestId('confirmation-summary')
  await expect(summary).toContainText(CONFIRM.name)
  await expect(summary).toContainText('Dates')

  // While waiting for confirmation, the other sections are locked and point back here.
  await expect(banner(page)).toContainText(`${CONFIRM.name} is waiting for your confirmation`)
  await expect(banner(page).getByRole('link')).toHaveCount(0)
  await expect(main(page).getByText('These details are locked while MUN Hub reviews your MUN.')).toBeVisible()
})

test('other sections show the lock banner with a way back to the confirmation', async ({ page }) => {
  await openSection(page, munId, 'committees', /Committees/)
  await expect(banner(page)).toContainText(`${CONFIRM.name} is waiting for your confirmation`)
  await banner(page).getByRole('link', { name: 'Confirm submission' }).click()
  await expect(page).toHaveURL(new RegExp(`/organizer/dashboard/${munId}/setup$`))
})

test('confirming needs the attestation, then MUN Hub starts verifying', async ({ page }) => {
  await openSetup(page)
  const confirm = main(page).getByRole('button', { name: 'Confirm & send for verification' })
  await expect(confirm).toBeDisabled()
  await main(page).getByRole('checkbox', { name: /^I confirm that everything in this submission is accurate/ }).click()
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(toast(page, 'Confirmed. MUN Hub is now verifying your MUN.')).toBeVisible()
  expect(await status()).toBe('VERIFICATION')
  await expect(main(page).getByRole('heading', { level: 2, name: 'Confirm your submission' })).toHaveCount(0)
  await expect(banner(page)).toContainText(`MUN Hub is reviewing ${CONFIRM.name}`)

  await openSection(page, munId, 'products', /Registration Products/)
  await expect(banner(page).getByRole('link', { name: 'See review status' })).toHaveAttribute(
    'href',
    `/organizer/dashboard/${munId}/setup`,
  )
})

test('after changes are requested, the feedback shows what to fix and unlocks the section', async ({ page }) => {
  const admin = await request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL },
    storageState: STORAGE_STATE.admin,
  })
  const note = `Add the venue's floor plan (${Date.now()})`
  const decided = await admin.post(`muns/${munId}/submission/actions/review`, {
    data: { decision: 'CHANGES_REQUESTED', notes: note, issues: [{ severity: 'HIGH', reason: 'Venue details are too thin' }] },
  })
  expect(decided.status(), await decided.text()).toBe(200)
  await admin.dispose()

  await openSetup(page)
  const feedback = main(page).getByRole('heading', { level: 2, name: 'Feedback from MUN Hub' })
  await expect(feedback).toBeVisible()
  await expect(main(page).getByRole('heading', { level: 3, name: 'Reviewer notes' })).toBeVisible()
  await expect(main(page)).toContainText(note)
  await expect(main(page).getByRole('heading', { level: 3, name: 'What to fix' })).toBeVisible()
  await expect(main(page)).toContainText('Venue details are too thin')
  // The MUN is back with the organizer, so the details form is editable again.
  await expect(banner(page)).toHaveCount(0)
  await expect(main(page).getByText('These details are locked while MUN Hub reviews your MUN.')).toHaveCount(0)
})
