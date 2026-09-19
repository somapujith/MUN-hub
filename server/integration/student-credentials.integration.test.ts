import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { achievements, certificates } from '@/lib/db/schema'
import { addDelegate, makeOpsFixture } from '@/lib/actions/test-fixtures/organizer-ops'
import { createApp } from '../src/app'
import { authHeaders } from './helpers'

// HTTP surface of the delegate's own certificates and achievements.

const app = createApp()

describe('GET /me/credentials', () => {
  it('needs a signed-in user', async () => {
    expect((await app.request('/api/v1/me/credentials')).status).toBe(401)
  })

  it("returns only the caller's verified awards and certificates, uncached", async () => {
    const fixture = await makeOpsFixture()
    const mine = await addDelegate(fixture, { status: 'ATTENDED', seated: true })
    const other = await addDelegate(fixture, { status: 'ATTENDED', seated: true })
    await db.insert(achievements).values([
      {
        userId: mine.user.id,
        munId: fixture.mun.id,
        registrationId: mine.registration.id,
        award: 'Best Delegate',
        verificationStatus: 'verified',
      },
      // Not verified yet — must stay hidden.
      { userId: mine.user.id, munId: fixture.mun.id, registrationId: mine.registration.id, award: 'Draft award' },
      {
        userId: other.user.id,
        munId: fixture.mun.id,
        registrationId: other.registration.id,
        award: 'Someone else',
        verificationStatus: 'verified',
      },
    ])
    await db.insert(certificates).values([
      {
        userId: mine.user.id,
        munId: fixture.mun.id,
        registrationId: mine.registration.id,
        certificateUrl: 'https://files.example/mine.pdf',
        verificationStatus: 'verified',
      },
      { userId: other.user.id, munId: fixture.mun.id, registrationId: other.registration.id },
    ])

    const res = await app.request('/api/v1/me/credentials', { headers: await authHeaders(mine.user.id) })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.achievements.map((row: { award: string }) => row.award)).toEqual(['Best Delegate'])
    expect(body.certificates).toHaveLength(1)
    expect(body.certificates[0]).toMatchObject({
      downloadUrl: 'https://files.example/mine.pdf',
      verified: true,
      munName: fixture.mun.name,
    })
  })
})
