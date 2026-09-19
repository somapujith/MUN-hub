import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { achievements, certificates } from '@/lib/db/schema'
import { listMyCredentials } from './student-credentials'
import { addDelegate, makeOpsFixture, sessionFor } from './test-fixtures/organizer-ops'

async function award(
  delegate: Awaited<ReturnType<typeof addDelegate>>,
  munId: string,
  values: Partial<typeof achievements.$inferInsert> = {},
) {
  const [row] = await db
    .insert(achievements)
    .values({
      userId: delegate.user.id,
      munId,
      registrationId: delegate.registration.id,
      committee: 'UNSC',
      portfolio: 'France',
      award: 'Best Delegate',
      ...values,
    })
    .returning()
  return row
}

async function certificate(
  delegate: Awaited<ReturnType<typeof addDelegate>>,
  munId: string,
  values: Partial<typeof certificates.$inferInsert> = {},
) {
  const [row] = await db
    .insert(certificates)
    .values({ userId: delegate.user.id, munId, registrationId: delegate.registration.id, ...values })
    .returning()
  return row
}

describe('listMyCredentials', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(listMyCredentials(null)).rejects.toThrow('Forbidden')
  })

  it('is empty for a delegate with nothing issued', async () => {
    const fixture = await makeOpsFixture()
    const delegate = await addDelegate(fixture, { status: 'ATTENDED' })
    await expect(listMyCredentials(sessionFor(delegate.user))).resolves.toEqual({
      achievements: [],
      certificates: [],
    })
  })

  it('only shows an award once MUN Hub has verified it', async () => {
    const fixture = await makeOpsFixture()
    const delegate = await addDelegate(fixture, { status: 'ATTENDED', seated: true })
    const draft = await award(delegate, fixture.mun.id)
    const session = sessionFor(delegate.user)

    expect((await listMyCredentials(session)).achievements).toEqual([])

    await db.update(achievements).set({ verificationStatus: 'verified' }).where(eq(achievements.id, draft.id))
    const { achievements: shown } = await listMyCredentials(session)
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({
      id: draft.id,
      munId: fixture.mun.id,
      munName: fixture.mun.name,
      city: 'Hyderabad',
      committee: 'UNSC',
      portfolio: 'France',
      award: 'Best Delegate',
    })
    expect(shown[0].awardedAt).toBeInstanceOf(Date)
  })

  it("never returns another delegate's awards or certificates", async () => {
    const fixture = await makeOpsFixture()
    const mine = await addDelegate(fixture, { status: 'ATTENDED' })
    const theirs = await addDelegate(fixture, { status: 'ATTENDED' })
    await award(theirs, fixture.mun.id, { verificationStatus: 'verified' })
    await certificate(theirs, fixture.mun.id, { certificateUrl: 'https://files.example/theirs.pdf' })

    await expect(listMyCredentials(sessionFor(mine.user))).resolves.toEqual({ achievements: [], certificates: [] })
    const own = await listMyCredentials(sessionFor(theirs.user))
    expect(own.achievements).toHaveLength(1)
    expect(own.certificates).toHaveLength(1)
  })

  it('lists certificates with their download link and verification state, newest first', async () => {
    const fixture = await makeOpsFixture()
    const delegate = await addDelegate(fixture, { status: 'ATTENDED' })
    const older = await certificate(delegate, fixture.mun.id, {
      certificateUrl: 'https://files.example/older.pdf',
      verificationStatus: 'verified',
      createdAt: new Date('2027-01-01T00:00:00Z'),
    })
    const newer = await certificate(delegate, fixture.mun.id, {
      certificateUrl: null,
      createdAt: new Date('2027-02-01T00:00:00Z'),
    })

    const { certificates: shown } = await listMyCredentials(sessionFor(delegate.user))
    expect(shown.map((row) => row.id)).toEqual([newer.id, older.id])
    expect(shown[0]).toMatchObject({ downloadUrl: null, verified: false, munName: fixture.mun.name })
    expect(shown[1]).toMatchObject({ downloadUrl: 'https://files.example/older.pdf', verified: true })
    // The raw column names must not leak through alongside the derived ones.
    expect(shown[0]).not.toHaveProperty('certificateUrl')
    expect(shown[0]).not.toHaveProperty('verificationStatus')
  })

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '/relative/file.pdf', 'not a url', '   '])(
    'never hands out a non-web certificate link (%s)',
    async (link) => {
      const fixture = await makeOpsFixture()
      const delegate = await addDelegate(fixture, { status: 'ATTENDED' })
      await certificate(delegate, fixture.mun.id, { certificateUrl: link })

      const { certificates: shown } = await listMyCredentials(sessionFor(delegate.user))
      expect(shown).toHaveLength(1)
      expect(shown[0].downloadUrl).toBeNull()
    },
  )
})
