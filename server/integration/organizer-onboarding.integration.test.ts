import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  return app.request(`/api/v1/organizer/onboarding${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('organizer onboarding routes', () => {
  it('runs the whole wizard over HTTP and then locks it', async () => {
    const organizer = await makeUser('ORGANIZER')
    const headers = await authHeaders(organizer.id)

    const start = await call('GET', '', headers)
    expect(start.status).toBe(200)
    expect((await start.json()).nextStep).toBe('PROFILE')

    const steps: Array<[string, string, unknown]> = [
      ['PUT', '/profile', { firstName: 'Ravi', lastName: 'Menon', contactPhone: '9123456780' }],
      ['PUT', '/mun', { munName: 'Coastal MUN', munCity: 'Kochi', munStartDate: '2027-02-10' }],
      [
        'PUT',
        '/details',
        { expectedDelegateCount: 200, munDescription: 'Two days, six committees, open to school and college delegates.' },
      ],
      ['PUT', '/payment', { upiId: 'ravi@ybl', upiPhone: '9123456780' }],
      ['POST', '/agreement', { accepted: true }],
    ]
    for (const [method, path, body] of steps) {
      const res = await call(method, path, headers, body)
      expect(res.status, `${method} ${path}`).toBe(200)
    }

    const done = await (await call('GET', '', headers)).json()
    expect(done).toMatchObject({ completed: true, nextStep: null })
    expect(done.firstMunId).toEqual(expect.any(String))

    // The wizard filed the first application; a second one waits until that's reviewed.
    const mine = await app.request('/api/v1/organizer/applications', { headers })
    expect(mine.status).toBe(200)
    expect((await mine.json()).map((a: { munName: string }) => a.munName)).toEqual(['Coastal MUN'])

    const again = await app.request('/api/v1/organizer/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        conferenceName: 'Second MUN',
        expectedDate: '2027-05-01T00:00:00.000Z',
        location: 'Kochi',
        expectedDelegateCount: 50,
        description: 'Trying to file a second application after the wizard did.',
      }),
    })
    expect(again.status).toBe(409)

    const locked = await call('PUT', '/payment', headers, { upiId: 'other@ybl', upiPhone: '9123456780' })
    expect(locked.status).toBe(409)
  })

  it('maps field errors to 400 and out-of-order steps to 409', async () => {
    const organizer = await makeUser('ORGANIZER')
    const headers = await authHeaders(organizer.id)

    const outOfOrder = await call('PUT', '/payment', headers, { upiId: 'ravi@ybl', upiPhone: '9123456780' })
    expect(outOfOrder.status).toBe(409)

    const badPhone = await call('PUT', '/profile', headers, { firstName: 'A', lastName: 'B', contactPhone: '123' })
    expect(badPhone.status).toBe(400)
    expect((await badPhone.json()).error.message).toBe('Contact number must be a 10-digit Indian mobile number')

    const smuggled = await call('PUT', '/profile', headers, {
      firstName: 'A',
      lastName: 'B',
      contactPhone: '9123456780',
      completedAt: '2026-01-01',
    })
    expect(smuggled.status).toBe(400)
  })

  it('is closed to delegates and anonymous callers', async () => {
    const student = await makeUser('STUDENT')
    expect((await call('GET', '', await authHeaders(student.id))).status).toBe(403)
    expect((await call('GET', '', {})).status).toBe(401)
  })
})
