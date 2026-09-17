import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkInCodeFor, formatCheckInCode } from '@/lib/actions/check-in'
import { COMMUNICATION_LIMITS } from '@/lib/actions/organizer-ops-errors'
import { addDelegate, makeOpsFixture, makeUser } from '@/lib/actions/test-fixtures/organizer-ops'
import { consoleNotificationsAdapter } from '@/lib/notifications/console-adapter'
import { createApp } from '../src/app'
import { authHeaders } from './helpers'

// HTTP surface of organizer operations: roster search/detail/export/
// attendance, delegate messages, check-in and the delegate pass, results.

const app = createApp()

function json(headers: Record<string, string>, body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

beforeEach(() => {
  vi.spyOn(consoleNotificationsAdapter, 'send').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('roster routes', () => {
  it('searches and filters by status list', async () => {
    const fixture = await makeOpsFixture()
    const asha = await addDelegate(fixture, { name: 'Asha Rao' })
    await addDelegate(fixture, { name: 'Kabir Shah', status: 'CANCELLED' })
    const headers = await authHeaders(fixture.organizer.id)
    const base = `/api/v1/organizer/muns/${fixture.mun.id}/delegates`

    const searched = await app.request(`${base}?search=asha`, { headers })
    expect(searched.status).toBe(200)
    const body = await searched.json()
    expect(body).toMatchObject({ total: 1, munStatus: 'CONFERENCE_ACTIVE', attendanceOpen: true })
    expect(body.results[0].id).toBe(asha.registration.id)

    const confirmed = await (await app.request(`${base}?status=CONFIRMED,ATTENDED`, { headers })).json()
    expect(confirmed.total).toBe(1)

    expect((await app.request(`${base}?status=BOGUS`, { headers })).status).toBe(400)
    expect((await app.request(`${base}?search=${'x'.repeat(101)}`, { headers })).status).toBe(400)
  })

  it('exports CSV for the owner only', async () => {
    const fixture = await makeOpsFixture()
    await addDelegate(fixture, { name: '=cmd' })
    const admin = await makeUser('ADMIN')
    const url = `/api/v1/organizer/muns/${fixture.mun.id}/delegates/export?status=CONFIRMED`

    const res = await app.request(url, { headers: await authHeaders(fixture.organizer.id) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="ops-mun-.+-delegates-.+\.csv"$/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    // Response#text() strips a BOM while decoding, so check the raw bytes.
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes)).toContain(",'=cmd,")

    expect((await app.request(url, { headers: await authHeaders(admin.id) })).status).toBe(403)
    expect((await app.request(url)).status).toBe(401)
  })

  it('serves the detail drawer to the owner only and marks attendance', async () => {
    const fixture = await makeOpsFixture()
    const { registration } = await addDelegate(fixture)
    const other = await makeOpsFixture()
    const { registration: foreign } = await addDelegate(other)
    const headers = await authHeaders(fixture.organizer.id)
    const admin = await makeUser('ADMIN')
    const base = `/api/v1/organizer/muns/${fixture.mun.id}/delegates`

    const detail = await app.request(`${base}/${registration.id}`, { headers })
    expect(detail.status).toBe(200)
    expect((await detail.json()).checkIn.state).toBe('NOT_CHECKED_IN')
    expect((await app.request(`${base}/${registration.id}`, { headers: await authHeaders(admin.id) })).status).toBe(403)
    expect((await app.request(`${base}/${foreign.id}`, { headers })).status).toBe(404)

    const marked = await app.request(`${base}/${registration.id}/attendance`, json(headers, { status: 'NO_SHOW' }, 'PUT'))
    expect(marked.status).toBe(200)
    expect((await marked.json()).status).toBe('NO_SHOW')
    const invalid = await app.request(`${base}/${registration.id}/attendance`, json(headers, { status: 'CANCELLED' }, 'PUT'))
    expect(invalid.status).toBe(400)

    const closed = await makeOpsFixture({ status: 'REGISTRATION_OPEN' })
    const { registration: early } = await addDelegate(closed)
    const conflict = await app.request(
      `/api/v1/organizer/muns/${closed.mun.id}/delegates/${early.id}/attendance`,
      json(await authHeaders(closed.organizer.id), { status: 'ATTENDED' }, 'PUT'),
    )
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).error.code).toBe('CONFLICT_STATE')
  })
})

describe('check-in and pass routes', () => {
  it("checks a delegate in with the code from their own pass", async () => {
    const fixture = await makeOpsFixture()
    const { user, registration } = await addDelegate(fixture, { name: 'Asha Rao' })

    const passRes = await app.request(`/api/v1/me/registrations/${registration.id}/pass`, {
      headers: await authHeaders(user.id),
    })
    expect(passRes.status).toBe(200)
    const pass = await passRes.json()
    expect(pass.checkInCode).toBe(formatCheckInCode(checkInCodeFor(registration.id)))
    expect(
      (await app.request(`/api/v1/me/registrations/${registration.id}/pass`, {
        headers: await authHeaders(fixture.organizer.id),
      })).status,
    ).toBe(404)

    const url = `/api/v1/organizer/muns/${fixture.mun.id}/check-in`
    const headers = await authHeaders(fixture.organizer.id)
    const first = await app.request(url, json(headers, { code: pass.checkInCode }))
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ outcome: 'CHECKED_IN', delegate: { name: 'Asha Rao' } })
    const again = await app.request(url, json(headers, { code: pass.checkInCode }))
    expect((await again.json()).outcome).toBe('ALREADY_CHECKED_IN')

    const unknown = await app.request(url, json(headers, { code: 'ZZZZZ-ZZZZZ' }))
    expect(unknown.status).toBe(404)
    const malformed = await app.request(url, json(headers, { code: 'nope' }))
    expect(malformed.status).toBe(400)
    const stranger = await makeUser('ORGANIZER')
    expect((await app.request(url, json(await authHeaders(stranger.id), { code: pass.checkInCode }))).status).toBe(403)
  })
})

describe('communications routes', () => {
  it('previews, sends, lists, and rate-limits delegate messages', async () => {
    const fixture = await makeOpsFixture()
    await addDelegate(fixture, { seated: true })
    await addDelegate(fixture, { status: 'ATTENDED' })
    const headers = await authHeaders(fixture.organizer.id)
    const base = `/api/v1/organizer/muns/${fixture.mun.id}/communications`

    const preview = await app.request(`${base}/audience?status=CONFIRMED&committeeId=${fixture.committee.id}`, {
      headers,
    })
    expect(preview.status).toBe(200)
    expect((await preview.json()).recipientCount).toBe(1)
    expect((await app.request(`${base}/audience?status=CANCELLED`, { headers })).status).toBe(400)

    const message = { subject: 'Schedule', body: 'Opening ceremony at 9.', audience: { statuses: ['CONFIRMED', 'ATTENDED'] } }
    const sent = await app.request(base, json(headers, message))
    expect(sent.status).toBe(201)
    expect(await sent.json()).toEqual({ recipientCount: 2, sent: 2, failed: 0 })

    const history = await (await app.request(base, { headers })).json()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ subject: 'Schedule', recipientCount: 2 })

    const tooLong = await app.request(base, json(headers, { ...message, subject: 'x'.repeat(151) }))
    expect(tooLong.status).toBe(400)
    const extraKey = await app.request(base, json(headers, { ...message, audience: { statuses: [], userIds: ['x'] } }))
    expect(extraKey.status).toBe(400)

    for (let i = 1; i < COMMUNICATION_LIMITS.maxSendsPerHour; i += 1) {
      expect((await app.request(base, json(headers, message))).status).toBe(201)
    }
    const limited = await app.request(base, json(headers, message))
    expect(limited.status).toBe(429)
    expect((await limited.json()).error.code).toBe('RATE_LIMITED')

    const admin = await makeUser('ADMIN')
    expect((await app.request(base, json(await authHeaders(admin.id), message))).status).toBe(403)
  })
})

describe('results routes', () => {
  it('reports state, submits for review, and lets staff approve', async () => {
    const fixture = await makeOpsFixture()
    const { registration } = await addDelegate(fixture, { status: 'ATTENDED' })
    const headers = await authHeaders(fixture.organizer.id)
    const base = `/api/v1/organizer/muns/${fixture.mun.id}`

    const empty = await app.request(`${base}/results/submit`, { method: 'POST', headers })
    expect(empty.status).toBe(409)

    const award = await app.request(`${base}/achievements`, json(headers, { registrationId: registration.id, award: 'Best Delegate' }))
    expect(award.status).toBe(201)
    const submitted = await app.request(`${base}/results/submit`, { method: 'POST', headers })
    expect(submitted.status).toBe(200)
    expect((await submitted.json()).munStatus).toBe('RESULTS_UNDER_REVIEW')
    expect((await (await app.request(`${base}/results`, { headers })).json()).editable).toBe(false)

    const review = `/api/v1/admin/muns/${fixture.mun.id}/results/review`
    expect((await app.request(review, json(headers, { decision: 'APPROVE' }))).status).toBe(403)
    const staff = await makeUser('ADMIN')
    const approved = await app.request(review, json(await authHeaders(staff.id), { decision: 'APPROVE' }))
    expect(approved.status).toBe(200)
    expect((await approved.json()).munStatus).toBe('COMPLETED')
  })
})
