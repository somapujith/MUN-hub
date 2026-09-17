import { describe, it, expect } from 'vitest'
import { db } from '@/lib/db/client'
import {
  munPaymentSettings,
  muns,
  organizerApplications,
  users,
  verificationIssues,
  verificationLogs,
} from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { getConfirmationPreview, getMunProgress, getMunReviewFeedback } from './go-live-dashboard'
import { TRACKED_MODULES } from '@/lib/lifecycle/module-registry'
import { ORGANIZER_ATTESTATION } from '@/lib/lifecycle/organizer-confirmation'

async function makeUser(role: Role) {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

async function makeMun(organizerId: string) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name: 'Dashboard Mun', slug: `dashboard-mun-${crypto.randomUUID()}`, status: 'ONBOARDING' })
    .returning()
  return mun
}

function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

describe('getMunProgress', () => {
  it('lets the owning organizer read their own progress', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const progress = await getMunProgress(mun.id, sessionFor(organizer))

    expect(progress.munId).toBe(mun.id)
    expect(progress.lifecycleStatus).toBe('ONBOARDING')
    expect(progress.modules).toHaveLength(TRACKED_MODULES.length)
    expect(progress.requiredTotal).toBeGreaterThan(0)
    expect(progress.submission).toBeNull()
  })

  it('rejects a non-owning organizer with Forbidden', async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(getMunProgress(mun.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
  })

  it('rejects an unauthenticated caller with Forbidden', async () => {
    const owner = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(getMunProgress(mun.id, null)).rejects.toThrow('Forbidden')
  })

  it('allows an OPERATIONS role even though they do not own the mun', async () => {
    const owner = await makeUser('ORGANIZER')
    const ops = await makeUser('OPERATIONS')
    const mun = await makeMun(owner.id)

    const progress = await getMunProgress(mun.id, sessionFor(ops))
    expect(progress.munId).toBe(mun.id)
  })

  it('allows ADMIN and SUPER_ADMIN roles even though they do not own the mun', async () => {
    const owner = await makeUser('ORGANIZER')
    const admin = await makeUser('ADMIN')
    const superAdmin = await makeUser('SUPER_ADMIN')
    const mun = await makeMun(owner.id)

    await expect(getMunProgress(mun.id, sessionFor(admin))).resolves.toBeDefined()
    await expect(getMunProgress(mun.id, sessionFor(superAdmin))).resolves.toBeDefined()
  })

  it('does not include ops-only fields such as internalNotes', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const progress = await getMunProgress(mun.id, sessionFor(organizer))
    expect(progress).not.toHaveProperty('internalNotes')
    expect(JSON.stringify(progress)).not.toContain('internalNotes')
  })

  it("lists every module's checks so the organizer can see what is missing", async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)

    const progress = await getMunProgress(mun.id, sessionFor(organizer))
    const basicInfo = progress.modules.find((m) => m.key === 'BASIC_INFO')!
    expect(basicInfo.verificationState).toBe('NOT_SUBMITTED')
    expect(basicInfo.checks.length).toBeGreaterThan(0)
    expect(basicInfo.checks.some((check) => !check.passed)).toBe(true)
    for (const check of basicInfo.checks) {
      expect(check.label).toBeTruthy()
    }
  })
})

describe('getMunReviewFeedback', () => {
  it("returns staff notes from both gates and reviewer issues, never internal notes or the organizer's own log lines", async () => {
    const organizer = await makeUser('ORGANIZER')
    const reviewer = await makeUser('OPERATIONS')
    const mun = await makeMun(organizer.id)
    await db.insert(organizerApplications).values({
      organizerId: organizer.id,
      munId: mun.id,
      status: 'CHANGES_REQUESTED',
      reviewNotes: 'Tell us about your previous editions',
    })
    await db.insert(verificationLogs).values([
      {
        munId: mun.id,
        reviewerId: reviewer.id,
        action: 'ACTION_REQUIRED',
        notes: 'Committee agendas are missing',
        internalNotes: 'secret triage note',
        createdAt: new Date('2027-01-02T00:00:00Z'),
      },
      { munId: mun.id, reviewerId: reviewer.id, action: 'VERIFICATION', notes: '', createdAt: new Date('2027-01-03T00:00:00Z') },
      { munId: mun.id, reviewerId: organizer.id, action: 'CONTENT_SUBMITTED', notes: 'Organizer submitted', createdAt: new Date('2027-01-01T00:00:00Z') },
    ])
    await db.insert(verificationIssues).values([
      { munId: mun.id, moduleName: 'COMMITTEES', severity: 'HIGH', reason: 'Add an agenda to UNSC', raisedBy: reviewer.id, source: 'REVIEWER' },
      { munId: mun.id, moduleName: 'BRANDING', severity: 'BLOCKER', reason: 'Logo missing', raisedBy: organizer.id, source: 'AUTOMATED' },
    ])

    const feedback = await getMunReviewFeedback(mun.id, sessionFor(organizer))

    expect(feedback.application).toMatchObject({ status: 'CHANGES_REQUESTED', reviewNotes: 'Tell us about your previous editions' })
    expect(feedback.submission).toBeNull()
    expect(feedback.reviewerNotes.map((note) => note.notes)).toEqual(['Committee agendas are missing'])
    expect(feedback.issues).toHaveLength(1)
    expect(feedback.issues[0]).toMatchObject({ moduleName: 'COMMITTEES', moduleLabel: expect.any(String), resolved: false })
    expect(JSON.stringify(feedback)).not.toContain('secret triage note')
  })

  it("refuses another organizer's mun", async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(getMunReviewFeedback(mun.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
    await expect(getMunReviewFeedback(mun.id, null)).rejects.toThrow('Forbidden')
  })
})

describe('getConfirmationPreview', () => {
  it('returns the snapshot and the attestation, without payment ciphertext', async () => {
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id)
    await db.insert(munPaymentSettings).values({
      munId: mun.id,
      legalName: 'Preview Org',
      orgType: 'NGO',
      addressLine1: 'Addr',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500001',
      panLast4: '1234',
      panCiphertext: 'pan-ciphertext-value',
      authorizedRepName: 'Rep',
      authorizedRepEmail: 'rep@preview.test',
      accountHolderName: 'Preview Org',
      bankName: 'Bank',
      accountNumberLast4: '5678',
      accountNumberCiphertext: 'account-ciphertext-value',
      ifsc: 'TEST0001234',
      accountType: 'current',
      gateway: 'razorpay',
    })

    const preview = await getConfirmationPreview(mun.id, sessionFor(organizer))

    expect(preview.attestation).toBe(ORGANIZER_ATTESTATION)
    expect(preview.snapshot.mun?.id).toBe(mun.id)
    expect(preview.snapshot.paymentSettings?.legalName).toBe('Preview Org')
    expect(JSON.stringify(preview)).not.toContain('ciphertext-value')
  })

  it("refuses another organizer's mun", async () => {
    const owner = await makeUser('ORGANIZER')
    const stranger = await makeUser('ORGANIZER')
    const mun = await makeMun(owner.id)

    await expect(getConfirmationPreview(mun.id, sessionFor(stranger))).rejects.toThrow('Forbidden')
  })
})
