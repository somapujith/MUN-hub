import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, users, verificationLogs } from '@/lib/db/schema'
import { canTransition, transitionMun } from './mun-state-machine'

describe('canTransition', () => {
  it('allows DRAFT to SUBMITTED', () => {
    expect(canTransition('DRAFT', 'SUBMITTED')).toBe(true)
  })

  it('disallows DRAFT to PUBLISHED (skipping review)', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false)
  })

  it('allows UNDER_REVIEW to APPROVED', () => {
    expect(canTransition('UNDER_REVIEW', 'APPROVED')).toBe(true)
  })

  it('allows CHANGES_REQUESTED back to SUBMITTED', () => {
    expect(canTransition('CHANGES_REQUESTED', 'SUBMITTED')).toBe(true)
  })

  it('allows VERIFICATION to PUBLISHED', () => {
    expect(canTransition('VERIFICATION', 'PUBLISHED')).toBe(true)
  })

  it('treats REJECTED as terminal', () => {
    expect(canTransition('REJECTED', 'SUBMITTED')).toBe(false)
    expect(canTransition('REJECTED', 'UNDER_REVIEW')).toBe(false)
  })

  it('treats ARCHIVED as terminal', () => {
    expect(canTransition('ARCHIVED', 'DRAFT')).toBe(false)
  })
})

describe('transitionMun', () => {
  let munId: string
  let reviewerId: string

  beforeAll(async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org', email: `org-${Date.now()}@test.com`, role: 'ORGANIZER' })
      .returning()

    const [reviewer] = await db
      .insert(users)
      .values({ name: 'Reviewer', email: `rev-${Date.now()}@test.com`, role: 'OPERATIONS' })
      .returning()
    reviewerId = reviewer.id

    const [mun] = await db
      .insert(muns)
      .values({
        organizerId: organizer.id,
        name: 'State Machine Mun',
        slug: `sm-mun-${Date.now()}`,
        status: 'SUBMITTED',
      })
      .returning()
    munId = mun.id
  })

  it('transitions and writes a verification log', async () => {
    const updated = await transitionMun(munId, 'UNDER_REVIEW', reviewerId, 'starting review')
    expect(updated.status).toBe('UNDER_REVIEW')

    const logs = await db.select().from(verificationLogs).where(eq(verificationLogs.munId, munId))
    expect(logs.length).toBe(1)
    expect(logs[0].action).toBe('UNDER_REVIEW')
    expect(logs[0].reviewerId).toBe(reviewerId)
    expect(logs[0].notes).toBe('starting review')
  })

  it('throws on an invalid transition', async () => {
    await expect(transitionMun(munId, 'ARCHIVED', reviewerId)).rejects.toThrow(
      'Invalid transition from UNDER_REVIEW to ARCHIVED',
    )
  })

  it('throws Mun not found for a non-existent munId', async () => {
    await expect(transitionMun('does-not-exist', 'APPROVED', reviewerId)).rejects.toThrow('Mun not found')
  })

  it('sets publishedAt when transitioning to PUBLISHED', async () => {
    const [organizer] = await db
      .insert(users)
      .values({ name: 'Org2', email: `org2-${Date.now()}@test.com`, role: 'ORGANIZER' })
      .returning()

    const [mun] = await db
      .insert(muns)
      .values({
        organizerId: organizer.id,
        name: 'Publish Path Mun',
        slug: `publish-path-mun-${Date.now()}`,
        status: 'VERIFICATION',
      })
      .returning()

    expect(mun.publishedAt).toBeNull()

    const updated = await transitionMun(mun.id, 'PUBLISHED', reviewerId, 'ready to publish')
    expect(updated.status).toBe('PUBLISHED')
    expect(updated.publishedAt).toBeInstanceOf(Date)
  })

  afterAll(async () => {
    await db.$client.end()
  })
})
