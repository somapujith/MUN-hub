import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { API_ORIGIN, WEB_URL } from '../../env'
import { newApiContext, signUpOrganizerViaApi, signUpViaApi } from '../../fixtures/api'
import { recreateReadyMun } from '../../fixtures/fixture-db'
import { REVIEW, SUSPEND } from '../../fixtures/fixture-muns'
import { STORAGE_STATE } from '../../paths'
import { adminApi } from './_helpers'

/**
 * Gate 2 end to end through the API, on MUNs whose go-live modules are all
 * filled in (recreated at the start of this spec):
 * - e2e-review-mun: submit → organizer confirmation → changes requested →
 *   resubmit → approve → go-live queue → publish → unpublish.
 * - e2e-suspend-mun: published the same way, then suspended and reinstated.
 * Serial: each step builds on the last.
 */

test.describe.configure({ mode: 'serial' })

interface Progress {
  lifecycleStatus: string
  modules: Array<{
    key: string
    required: boolean
    checks?: Array<{ key: string; passed: boolean; severity: string; message?: string }>
  }>
}

let admin: APIRequestContext
let owner: APIRequestContext
let reviewId: string
let suspendId: string

async function organizerApi(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${API_ORIGIN}/api/v1/`,
    extraHTTPHeaders: { Origin: WEB_URL },
    storageState: STORAGE_STATE.organizer,
  })
}

async function status(munId: string): Promise<string> {
  const res = await admin.get(`admin/muns/${munId}/review`)
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()).status
}

async function publicStatus(slug: string): Promise<number> {
  const anon = await newApiContext()
  const res = await anon.get(`muns/${slug}`)
  await anon.dispose()
  return res.status()
}

async function submitAndConfirm(munId: string, name: string) {
  const submitted = await owner.post(`muns/${munId}/actions/submit-for-review`)
  expect(submitted.status(), await submitted.text()).toBe(200)
  const result = await submitted.json()
  expect(result, JSON.stringify(result)).toMatchObject({ passed: true })
  expect(await status(munId)).toBe('ORGANIZER_CONFIRMATION')

  const preview = await owner.get(`muns/${munId}/confirmation-preview`)
  expect(preview.status(), await preview.text()).toBe(200)
  const body = await preview.json()
  expect(body).toHaveProperty('snapshot')
  expect(body).toHaveProperty('attestation')
  expect(JSON.stringify(body.snapshot)).toContain(name)

  const confirmed = await owner.post(`muns/${munId}/actions/submit-final-confirmation`, { data: { attested: true } })
  expect(confirmed.status(), await confirmed.text()).toBe(200)
  expect(await status(munId)).toBe('VERIFICATION')
}

function review(context: APIRequestContext, munId: string, data: Record<string, unknown>) {
  return context.post(`muns/${munId}/submission/actions/review`, { data })
}

async function approveAndPublish(munId: string) {
  expect((await review(admin, munId, { decision: 'APPROVED' })).status()).toBe(200)
  expect((await admin.post(`muns/${munId}/submission/actions/enqueue`)).status()).toBe(200)
  const published = await admin.post(`muns/${munId}/actions/publish`, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  expect(published.status(), await published.text()).toBe(200)
  expect(await status(munId)).toBe('PUBLISHED')
}

test.beforeAll(async () => {
  admin = await adminApi()
  owner = await organizerApi()
  // Start from a clean copy every time, so a rerun without prepare-db works.
  reviewId = await recreateReadyMun(REVIEW)
  suspendId = await recreateReadyMun(SUSPEND)
})

test.afterAll(async () => {
  await admin?.dispose()
  await owner?.dispose()
})

test.describe('submission and review', () => {
  test('every required module passes its checks before submission', async () => {
    const res = await owner.get(`muns/${reviewId}/progress`)
    expect(res.status()).toBe(200)
    const progress = (await res.json()) as Progress
    expect(progress.lifecycleStatus).toBe('ONBOARDING')
    const failing = progress.modules
      .filter((m) => m.required)
      .flatMap((m) =>
        (m.checks ?? []).filter((c) => !c.passed && c.severity === 'BLOCKER').map((c) => `${m.key}: ${c.message ?? c.key}`),
      )
    expect(failing).toEqual([])
  })

  test('the organizer submits, previews and attests; the MUN enters review', async () => {
    await submitAndConfirm(reviewId, REVIEW.name)
  })

  test('review feedback is readable by the owner and staff only', async () => {
    expect((await owner.get(`muns/${reviewId}/review-feedback`)).status()).toBe(200)
    expect((await admin.get(`muns/${reviewId}/review-feedback`)).status()).toBe(200)
    const stranger = await signUpOrganizerViaApi()
    expect((await stranger.api.get(`muns/${reviewId}/review-feedback`)).status()).toBe(403)
    expect((await stranger.api.get(`muns/${reviewId}/confirmation-preview`)).status()).toBe(403)
    await stranger.api.dispose()
    const anon = await newApiContext()
    expect((await anon.get(`muns/${reviewId}/review-feedback`)).status()).toBe(401)
    await anon.dispose()
  })

  test('only staff can decide, and a rejection needs a reason', async () => {
    expect((await review(owner, reviewId, { decision: 'APPROVED' })).status()).toBe(403)
    const student = await signUpViaApi()
    expect((await review(student.api, reviewId, { decision: 'APPROVED' })).status()).toBe(403)
    await student.api.dispose()

    expect((await review(admin, reviewId, { decision: 'REJECTED' })).status()).toBe(400)
    expect((await review(admin, reviewId, { decision: 'MAYBE' })).status()).toBe(400)
    expect(await status(reviewId)).toBe('VERIFICATION')
  })

  test('staff request changes; the organizer sees the notes and issues', async () => {
    const note = `Please add the venue's street address (${Date.now()})`
    const res = await review(admin, reviewId, {
      decision: 'CHANGES_REQUESTED',
      notes: note,
      issues: [{ severity: 'HIGH', reason: 'Venue address is incomplete' }],
    })
    expect(res.status(), await res.text()).toBe(200)
    expect(await status(reviewId)).toBe('ACTION_REQUIRED')

    const feedback = await (await owner.get(`muns/${reviewId}/review-feedback`)).json()
    expect(JSON.stringify(feedback)).toContain(note)
    expect(JSON.stringify(feedback.issues)).toContain('Venue address is incomplete')
  })

  test('the organizer can resubmit after changes were requested', async () => {
    await submitAndConfirm(reviewId, REVIEW.name)
  })

  test('an organizer cannot publish their own MUN, and publish needs an idempotency key', async () => {
    const selfPublish = await owner.post(`muns/${reviewId}/actions/publish`, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(selfPublish.status()).toBe(403)
    expect((await admin.post(`muns/${reviewId}/actions/publish`)).status()).toBe(400)
  })

  test('staff approve; the MUN is verified but not yet public', async () => {
    const res = await review(admin, reviewId, { decision: 'APPROVED', notes: 'Looks good.' })
    expect(res.status(), await res.text()).toBe(200)
    expect(await status(reviewId)).toBe('VERIFIED')
    expect(await publicStatus(REVIEW.slug)).toBe(404)
  })
})

test.describe('go-live', () => {
  test('staff queue it for go-live; it shows in the queue', async () => {
    expect((await owner.post(`muns/${reviewId}/submission/actions/enqueue`)).status()).toBe(403)
    const res = await admin.post(`muns/${reviewId}/submission/actions/enqueue`)
    expect(res.status(), await res.text()).toBe(200)
    expect(await status(reviewId)).toBe('GO_LIVE_QUEUE')
    const queue = await (await admin.get('admin/go-live-queue?limit=100')).json()
    expect(JSON.stringify(queue)).toContain(reviewId)
  })

  test('staff publish it once, even when the request is replayed', async () => {
    const key = crypto.randomUUID()
    const first = await admin.post(`muns/${reviewId}/actions/publish`, { headers: { 'Idempotency-Key': key } })
    expect(first.status(), await first.text()).toBe(200)
    const replay = await admin.post(`muns/${reviewId}/actions/publish`, { headers: { 'Idempotency-Key': key } })
    expect(replay.status(), await replay.text()).toBe(200)
    expect(await status(reviewId)).toBe('PUBLISHED')

    const anon = await newApiContext()
    const detail = await anon.get(`muns/${REVIEW.slug}`)
    expect(detail.status()).toBe(200)
    expect((await detail.json()).name).toBe(REVIEW.name)
    await anon.dispose()
  })

  test('staff can unpublish, and the MUN disappears from public view', async () => {
    expect((await owner.post(`admin/muns/${reviewId}/unpublish`)).status()).toBe(403)
    const res = await admin.post(`admin/muns/${reviewId}/unpublish`)
    expect(res.status(), await res.text()).toBe(200)
    expect(await status(reviewId)).toBe('UNPUBLISHED')
    expect(await publicStatus(REVIEW.slug)).toBe(404)
  })

  test('an unpublished MUN can be queued and published again (fc05d9e)', async () => {
    const queued = await admin.post(`muns/${reviewId}/submission/actions/enqueue`)
    expect(queued.status(), await queued.text()).toBe(200)
    expect(await status(reviewId)).toBe('GO_LIVE_QUEUE')
    const queue = await (await admin.get('admin/go-live-queue?limit=100')).json()
    expect(JSON.stringify(queue)).toContain(reviewId)
    const published = await admin.post(`muns/${reviewId}/actions/publish`, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(published.status(), await published.text()).toBe(200)
    expect(await status(reviewId)).toBe('PUBLISHED')
  })
})

test.describe('suspension', () => {
  test('a published MUN can be suspended, with a reason, by staff only', async () => {
    await submitAndConfirm(suspendId, SUSPEND.name)
    await approveAndPublish(suspendId)
    expect(await publicStatus(SUSPEND.slug)).toBe(200)

    const suspend = (context: APIRequestContext, data: Record<string, unknown>) =>
      context.post(`admin/muns/${suspendId}/suspend`, { data })
    expect((await suspend(admin, {})).status()).toBe(400)
    expect((await suspend(admin, { reason: '' })).status()).toBe(400)
    expect((await suspend(owner, { reason: 'Mine' })).status()).toBe(403)
    const suspended = await suspend(admin, { reason: 'Organizer identity under review' })
    expect(suspended.status(), await suspended.text()).toBe(200)
    expect(await status(suspendId)).toBe('SUSPENDED')
    expect(await publicStatus(SUSPEND.slug)).toBe(404)
  })

  test('reinstating (staff only) sends the MUN back to verification', async () => {
    expect((await owner.post(`admin/muns/${suspendId}/reinstate`)).status()).toBe(403)
    const reinstated = await admin.post(`admin/muns/${suspendId}/reinstate`)
    expect(reinstated.status(), await reinstated.text()).toBe(200)
    expect(await status(suspendId)).toBe('VERIFICATION')
    expect(await publicStatus(SUSPEND.slug)).toBe(404)
  })
})
