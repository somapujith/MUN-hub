import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { achievements, muns, verificationLogs } from '@/lib/db/schema'
import { ORGANIZER_OPS_ERRORS } from './organizer-ops-errors'
import {
  createAchievement,
  deleteAchievement,
  getResultsState,
  listMunAchievements,
  reviewResults,
  submitResultsForReview,
} from './results'
import { addDelegate, makeOpsFixture, makeUser, sessionFor, type OpsFixture } from './test-fixtures/organizer-ops'

async function munStatus(munId: string) {
  const [row] = await db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId))
  return row.status
}

async function recordAward(fixture: OpsFixture, award = 'Best Delegate') {
  const { registration } = await addDelegate(fixture, { status: 'ATTENDED', seated: true })
  return createAchievement({ munId: fixture.mun.id, registrationId: registration.id, award }, fixture.organizerSession)
}

describe('awards', () => {
  it("default to the delegate's committee and portfolio, and accept overrides", async () => {
    const fixture = await makeOpsFixture()
    const defaulted = await recordAward(fixture, '  Best Delegate  ')
    expect(defaulted).toMatchObject({ award: 'Best Delegate', committee: 'UNSC', portfolio: 'France' })

    const { registration } = await addDelegate(fixture, { status: 'CONFIRMED' })
    const overridden = await createAchievement(
      { munId: fixture.mun.id, registrationId: registration.id, award: 'Verbal Mention', committee: 'Crisis' },
      fixture.organizerSession,
    )
    expect(overridden).toMatchObject({ committee: 'Crisis', portfolio: null })
  })

  it('only go to confirmed or attended delegates of this MUN', async () => {
    const fixture = await makeOpsFixture()
    const other = await makeOpsFixture()
    const session = fixture.organizerSession
    for (const status of ['NO_SHOW', 'CANCELLED', 'PAYMENT_PENDING'] as const) {
      const { registration } = await addDelegate(fixture, { status })
      await expect(
        createAchievement({ munId: fixture.mun.id, registrationId: registration.id, award: 'Best Delegate' }, session),
      ).rejects.toThrow(ORGANIZER_OPS_ERRORS.awardNeedsConfirmedDelegate)
    }
    const { registration: foreign } = await addDelegate(other)
    await expect(
      createAchievement({ munId: fixture.mun.id, registrationId: foreign.id, award: 'Best Delegate' }, session),
    ).rejects.toThrow('Forbidden')
    const { registration } = await addDelegate(fixture)
    await expect(
      createAchievement({ munId: fixture.mun.id, registrationId: registration.id, award: '   ' }, session),
    ).rejects.toThrow('Award name is required')
    expect(await listMunAchievements(fixture.mun.id, session)).toEqual([])
  })
})

describe('results publishing', () => {
  it('needs at least one award, then moves an active conference to review and locks awards', async () => {
    const fixture = await makeOpsFixture({ status: 'CONFERENCE_ACTIVE' })
    const session = fixture.organizerSession

    const before = await getResultsState(fixture.mun.id, session)
    expect(before).toMatchObject({ munStatus: 'CONFERENCE_ACTIVE', awardCount: 0, editable: true, canSubmit: true })
    await expect(submitResultsForReview(fixture.mun.id, session)).rejects.toThrow(ORGANIZER_OPS_ERRORS.resultsNeedAward)

    const award = await recordAward(fixture)
    const submitted = await submitResultsForReview(fixture.mun.id, session)
    expect(submitted).toMatchObject({
      munStatus: 'RESULTS_UNDER_REVIEW',
      awardCount: 1,
      editable: false,
      canSubmit: false,
      returnNote: null,
    })
    expect(submitted.submittedAt).toBeInstanceOf(Date)

    const hops = await db
      .select({ action: verificationLogs.action })
      .from(verificationLogs)
      .where(eq(verificationLogs.munId, fixture.mun.id))
      .orderBy(verificationLogs.createdAt)
    expect(hops.map((hop) => hop.action)).toEqual(['RESULTS_PENDING', 'RESULTS_UNDER_REVIEW'])

    await expect(recordAward(fixture)).rejects.toThrow(ORGANIZER_OPS_ERRORS.resultsLocked)
    await expect(deleteAchievement(award.id, session)).rejects.toThrow(ORGANIZER_OPS_ERRORS.resultsLocked)
    await expect(submitResultsForReview(fixture.mun.id, session)).rejects.toThrow(
      'Cannot submit results while the MUN is RESULTS_UNDER_REVIEW',
    )
  })

  it('cannot be submitted before the conference', async () => {
    const fixture = await makeOpsFixture({ status: 'REGISTRATION_OPEN' })
    await recordAward(fixture)
    expect((await getResultsState(fixture.mun.id, fixture.organizerSession)).canSubmit).toBe(false)
    await expect(submitResultsForReview(fixture.mun.id, fixture.organizerSession)).rejects.toThrow(
      'Cannot submit results while the MUN is REGISTRATION_OPEN',
    )
    expect(await munStatus(fixture.mun.id)).toBe('REGISTRATION_OPEN')
  })

  it('staff can return results with a note, and the organizer can fix and resubmit', async () => {
    const fixture = await makeOpsFixture()
    const operations = await makeUser('OPERATIONS')
    const award = await recordAward(fixture)
    await submitResultsForReview(fixture.mun.id, fixture.organizerSession)

    await expect(reviewResults(fixture.mun.id, 'RETURN', '  ', sessionFor(operations))).rejects.toThrow(
      ORGANIZER_OPS_ERRORS.returnNoteRequired,
    )
    const returned = await reviewResults(fixture.mun.id, 'RETURN', 'Add the committee for award 1', sessionFor(operations))
    expect(returned).toMatchObject({
      munStatus: 'RESULTS_PENDING',
      editable: true,
      canSubmit: true,
      returnNote: 'Add the committee for award 1',
    })
    expect((await getResultsState(fixture.mun.id, fixture.organizerSession)).returnNote).toBe(
      'Add the committee for award 1',
    )

    await deleteAchievement(award.id, fixture.organizerSession)
    await recordAward(fixture, 'Outstanding Delegate')
    const resubmitted = await submitResultsForReview(fixture.mun.id, fixture.organizerSession)
    expect(resubmitted).toMatchObject({ munStatus: 'RESULTS_UNDER_REVIEW', returnNote: null })
  })

  it('staff approval completes the MUN and verifies its awards', async () => {
    const fixture = await makeOpsFixture()
    const admin = await makeUser('ADMIN')
    await recordAward(fixture)
    await submitResultsForReview(fixture.mun.id, fixture.organizerSession)

    const approved = await reviewResults(fixture.mun.id, 'APPROVE', undefined, sessionFor(admin))
    expect(approved).toMatchObject({ munStatus: 'COMPLETED', editable: false, canSubmit: false })
    const rows = await db.select().from(achievements).where(eq(achievements.munId, fixture.mun.id))
    expect(rows.map((row) => row.verificationStatus)).toEqual(['verified'])

    await expect(reviewResults(fixture.mun.id, 'APPROVE', undefined, sessionFor(admin))).rejects.toThrow(
      ORGANIZER_OPS_ERRORS.resultsNotUnderReview,
    )
  })

  it('review is staff-only; submission is owner-or-admin', async () => {
    const fixture = await makeOpsFixture()
    const otherOrganizer = await makeUser('ORGANIZER')
    await recordAward(fixture)

    await expect(submitResultsForReview(fixture.mun.id, sessionFor(otherOrganizer))).rejects.toThrow('Forbidden')
    await expect(submitResultsForReview(fixture.mun.id, null)).rejects.toThrow('Forbidden')
    await submitResultsForReview(fixture.mun.id, fixture.organizerSession)
    await expect(reviewResults(fixture.mun.id, 'APPROVE', undefined, fixture.organizerSession)).rejects.toThrow(
      'Forbidden',
    )
    expect(await munStatus(fixture.mun.id)).toBe('RESULTS_UNDER_REVIEW')
  })
})
