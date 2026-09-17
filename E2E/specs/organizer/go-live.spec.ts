import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  anonApi,
  expectWorkspaceBug,
  main,
  openSection,
  organizerApi,
  prepareWorkspace,
  sandboxId,
  toast,
} from './_helpers'

/**
 * Go-live pipeline (Onboarding & Go-Live PRD): progress across the 15
 * modules, and the automated gate that refuses an incomplete submission.
 *
 * The sandbox is kept incomplete on purpose (no logo/cover — branding.spec
 * always removes its uploads). A failed submission legitimately moves it to
 * ACTION_REQUIRED; it must never end up in review.
 */

interface ModuleProgress {
  key: string
  label: string
  isRequired: boolean
  completionStatus: string
  blockingIssueCount: number
}

interface Progress {
  lifecycleStatus: string
  requiredTotal: number
  requiredComplete: number
  overallPercentage: number
  modules: ModuleProgress[]
}

interface SubmitResult {
  passed: boolean
  blockers: Array<{ key: string; label: string; message?: string; severity: string }>
  submissionId?: string
}

const IN_REVIEW = ['CONTENT_SUBMITTED', 'AUTOMATED_VALIDATION', 'ORGANIZER_CONFIRMATION', 'VERIFICATION', 'VERIFIED']

let api: APIRequestContext
let munId: string

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
  // Guarantee the sandbox is missing its required branding.
  const media: Array<{ id: string; kind: string }> = await (await api.get(`muns/${munId}/media`)).json()
  for (const m of media) await api.delete(`media/${m.id}`)
})

test.afterAll(async () => {
  const status = (await progress()).lifecycleStatus
  expect(IN_REVIEW, `sandbox was left in ${status}`).not.toContain(status)
  await api?.dispose()
})

async function progress(): Promise<Progress> {
  const res = await api.get(`muns/${munId}/progress`)
  expect(res.status()).toBe(200)
  return res.json()
}

async function submit(): Promise<SubmitResult> {
  const res = await api.post(`muns/${munId}/actions/submit-for-review`)
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}

test.describe('go-live progress', () => {
  test('lists all 15 modules and which are still incomplete', async () => {
    const p = await progress()
    expect(p.modules).toHaveLength(15)
    expect(p.requiredTotal).toBe(p.modules.filter((m) => m.isRequired).length)
    expect(p.requiredComplete).toBeLessThan(p.requiredTotal)
    expect(p.overallPercentage).toBeLessThan(100)
    const incomplete = p.modules.filter((m) => m.completionStatus !== 'COMPLETE').map((m) => m.key)
    expect(incomplete).toContain('BRANDING')
    expect(p.modules.find((m) => m.key === 'COMMITTEES')?.completionStatus).toBe('COMPLETE')
  })

  test('the setup page shows progress and each incomplete module', async ({ page }) => {
    expectWorkspaceBug()
    const p = await progress()
    await prepareWorkspace(page, api)
    await openSection(page, munId, 'setup', 'MUN Setup')
    const panel = main(page).getByRole('complementary')
    await expect(panel).toContainText('Go-live progress')
    await expect(panel).toContainText(`${p.requiredComplete}/${p.requiredTotal} required modules complete`)
    for (const m of p.modules.filter((x) => x.completionStatus !== 'COMPLETE')) {
      await expect(panel.getByRole('listitem').filter({ hasText: m.label }).first()).toContainText(m.completionStatus)
    }
    await expect(panel.getByRole('listitem').filter({ hasText: 'Branding' })).not.toContainText('COMPLETE')
  })

  test('progress is private to the owner', async () => {
    const anon = await anonApi()
    expect((await anon.get(`muns/${munId}/progress`)).status()).toBe(401)
    await anon.dispose()
  })
})

test.describe('submitting an incomplete MUN', () => {
  test('the API refuses it with blockers and does not open a review', async () => {
    const result = await submit()
    expect(result.passed, 'an incomplete MUN passed automated validation').toBe(false)
    expect(result.submissionId).toBeUndefined()
    expect(result.blockers.length).toBeGreaterThan(0)
    for (const blocker of result.blockers) {
      expect(blocker.key).toBeTruthy()
      expect(blocker.label ?? blocker.message).toBeTruthy()
    }
    expect(JSON.stringify(result.blockers)).toMatch(/logo|cover|brand/i)

    const after = await progress()
    expect(after.lifecycleStatus).toBe('ACTION_REQUIRED')
    expect(after.modules.find((m) => m.key === 'BRANDING')?.blockingIssueCount).toBeGreaterThan(0)

    // Resubmitting while still incomplete is refused the same way.
    const again = await submit()
    expect(again.passed).toBe(false)
    expect((await progress()).lifecycleStatus).toBe('ACTION_REQUIRED')
  })

  test('the final confirmation step is refused before validation passes', async () => {
    const res = await api.post(`muns/${munId}/actions/submit-final-confirmation`)
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
    expect(IN_REVIEW).not.toContain((await progress()).lifecycleStatus)
  })

  test('an organizer cannot review, queue or publish their own MUN', async () => {
    const review = await api.post(`muns/${munId}/submission/actions/review`, { data: { decision: 'APPROVED' } })
    expect(review.status()).toBe(403)
    const enqueue = await api.post(`muns/${munId}/submission/actions/enqueue`)
    expect(enqueue.status()).toBe(403)
    const publish = await api.post(`muns/${munId}/actions/publish`, { headers: { 'Idempotency-Key': crypto.randomUUID() } })
    expect(publish.status()).toBe(403)
    expect((await api.post(`admin/muns/${munId}/publish`)).status()).toBe(403)
    expect(['ONBOARDING', 'ACTION_REQUIRED']).toContain((await progress()).lifecycleStatus)
  })

  test('signed-out callers cannot submit', async () => {
    const anon = await anonApi()
    const res = await anon.post(`muns/${munId}/actions/submit-for-review`)
    expect([401, 403]).toContain(res.status())
    await anon.dispose()
  })

  test('the setup page shows the blockers when submission is refused', async ({ page }) => {
    expectWorkspaceBug()
    await prepareWorkspace(page, api)
    await openSection(page, munId, 'setup', 'MUN Setup')
    const submitButton = main(page).getByRole('button', { name: 'Submit for review' })
    await expect(submitButton).toBeEnabled()
    await expect(main(page).getByRole('button', { name: 'Confirm & send for verification' })).toBeDisabled()

    await submitButton.click()
    await expect(toast(page, /Automated validation found \d+ blocking issue\(s\)/)).toBeVisible()
    const blockers = main(page).getByRole('complementary').getByRole('list').last()
    await expect(blockers.getByRole('listitem').first()).toBeVisible()
    await expect(blockers).toContainText(/logo|cover/i)
    await expect(main(page).getByText('Automated validation passed')).toHaveCount(0)
    await expect(main(page).getByRole('button', { name: 'Confirm & send for verification' })).toBeDisabled()
    await expect(main(page).getByText(/Status: /)).toContainText(/action.required/i)
  })
})

