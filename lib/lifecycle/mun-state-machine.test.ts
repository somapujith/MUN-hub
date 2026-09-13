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

  it('disallows VERIFICATION directly to PUBLISHED (must pass through VERIFIED)', () => {
    expect(canTransition('VERIFICATION', 'PUBLISHED')).toBe(false)
  })

  it('treats REJECTED as terminal', () => {
    expect(canTransition('REJECTED', 'SUBMITTED')).toBe(false)
    expect(canTransition('REJECTED', 'UNDER_REVIEW')).toBe(false)
  })

  it('treats ARCHIVED as terminal', () => {
    expect(canTransition('ARCHIVED', 'DRAFT')).toBe(false)
  })
})

describe('new lifecycle states (verification/confirmation trust layer)', () => {
  it('allows CONTENT_SUBMITTED to ORGANIZER_CONFIRMATION', () => {
    expect(canTransition('CONTENT_SUBMITTED', 'ORGANIZER_CONFIRMATION')).toBe(true)
  })

  it('allows ORGANIZER_CONFIRMATION to VERIFICATION', () => {
    expect(canTransition('ORGANIZER_CONFIRMATION', 'VERIFICATION')).toBe(true)
  })

  it('allows VERIFICATION to VERIFIED', () => {
    expect(canTransition('VERIFICATION', 'VERIFIED')).toBe(true)
  })

  it('allows VERIFIED back to VERIFICATION (re-verification)', () => {
    expect(canTransition('VERIFIED', 'VERIFICATION')).toBe(true)
  })

  it('allows DRAFT to CANCELLED', () => {
    expect(canTransition('DRAFT', 'CANCELLED')).toBe(true)
  })

  it('treats CANCELLED as terminal', () => {
    expect(canTransition('CANCELLED', 'DRAFT')).toBe(false)
  })
})

describe('SUSPENDED transitions', () => {
  it('allows PUBLISHED -> SUSPENDED', () => {
    expect(canTransition('PUBLISHED', 'SUSPENDED')).toBe(true)
  })
  it('allows REGISTRATION_OPEN -> SUSPENDED', () => {
    expect(canTransition('REGISTRATION_OPEN', 'SUSPENDED')).toBe(true)
  })
  it('allows SUSPENDED -> VERIFICATION (reinstate re-runs verification)', () => {
    expect(canTransition('SUSPENDED', 'VERIFICATION')).toBe(true)
  })
  it('allows SUSPENDED -> CANCELLED', () => {
    expect(canTransition('SUSPENDED', 'CANCELLED')).toBe(true)
  })
  it('rejects DRAFT -> SUSPENDED', () => {
    expect(canTransition('DRAFT', 'SUSPENDED')).toBe(false)
  })
})

describe('unpublish transition', () => {
  it('allows PUBLISHED -> VERIFIED (unpublish)', () => {
    expect(canTransition('PUBLISHED', 'VERIFIED')).toBe(true)
  })
  it('rejects REGISTRATION_OPEN -> VERIFIED (registrations exist, must suspend instead)', () => {
    expect(canTransition('REGISTRATION_OPEN', 'VERIFIED')).toBe(false)
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
        status: 'VERIFIED',
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
