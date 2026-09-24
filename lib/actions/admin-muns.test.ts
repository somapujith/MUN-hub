import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import {
  adminActions,
  munModuleVerifications,
  munPaymentSettings,
  munSubmissions,
  muns,
  organizerApplications,
  registrationProducts,
  registrations,
  users,
  verificationLogs,
} from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import type { MunStatus, RegistrationStatus, SubmissionStatus } from '@/lib/db/schema-enums'
import { MODULE_REGISTRY } from '@/lib/lifecycle/module-registry'
import { getAdminMunDetail, getGoLiveQueueDetails, listAdminMuns } from './admin-muns'

type AnyRole = 'STUDENT' | 'ORGANIZER' | 'OPERATIONS' | 'ADMIN' | 'SUPER_ADMIN'

async function makeUser(role: AnyRole, name = `admin-muns ${role}`) {
  const [user] = await db
    .insert(users)
    .values({ name, email: `admin-muns-${crypto.randomUUID()}@test.dev`, role })
    .returning()
  return user
}

function sess(user: { id: string; role: AnyRole }): Session {
  return { userId: user.id, role: user.role }
}

async function makeMun(organizerId: string, status: MunStatus, name = `Conf ${crypto.randomUUID()}`) {
  const [mun] = await db
    .insert(muns)
    .values({ organizerId, name, slug: `conf-${crypto.randomUUID()}`, status, city: 'Hyderabad' })
    .returning()
  return mun
}

async function addRegistrations(munId: string, statuses: RegistrationStatus[]) {
  const [product] = await db
    .insert(registrationProducts)
    .values({ munId, name: 'Delegate', price: 1500, capacity: 100 })
    .returning()
  for (const status of statuses) {
    const delegate = await makeUser('STUDENT')
    await db.insert(registrations).values({ userId: delegate.id, munId, registrationProductId: product.id, status })
  }
}

async function addSubmission(munId: string, submittedBy: string, status: SubmissionStatus, extra: Partial<typeof munSubmissions.$inferInsert> = {}) {
  const [submission] = await db
    .insert(munSubmissions)
    .values({
      munId,
      submittedBy,
      versionNumber: 1,
      status,
      submittedAt: new Date(),
      slaDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...extra,
    })
    .returning()
  return submission
}

async function addPaymentSettings(munId: string, verificationState: 'PENDING' | 'VERIFIED' | 'FAILED') {
  await db.insert(munPaymentSettings).values({
    munId,
    legalName: 'Org',
    orgType: 'NGO',
    addressLine1: 'Addr',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCode: '500001',
    panLast4: '1234',
    panCiphertext: 'secret-pan-ciphertext',
    authorizedRepName: 'Rep',
    authorizedRepEmail: 'rep@test.dev',
    accountHolderName: 'Org',
    bankName: 'Bank',
    accountNumberLast4: '5678',
    accountNumberCiphertext: 'secret-account-ciphertext',
    ifsc: 'TEST0001234',
    accountType: 'current',
    gateway: 'razorpay',
    verificationState,
  })
}

describe('listAdminMuns', () => {
  it('searches by name, slug, organizer name and organizer email, with seat counts', async () => {
    const ops = await makeUser('OPERATIONS')
    const marker = `Zephyria-${crypto.randomUUID()}`
    const organizer = await makeUser('ORGANIZER', `${marker} Society`)
    const mun = await makeMun(organizer.id, 'REGISTRATION_OPEN', 'Plain conference name')
    await addRegistrations(mun.id, ['CONFIRMED', 'ATTENDED', 'PAYMENT_PENDING', 'PENDING', 'CANCELLED'])

    const byOrganizerName = await listAdminMuns({ q: marker.toLowerCase() }, sess(ops))
    expect(byOrganizerName.total).toBe(1)
    expect(byOrganizerName.results[0]).toMatchObject({
      id: mun.id,
      status: 'REGISTRATION_OPEN',
      organizerId: organizer.id,
      organizerEmail: organizer.email,
      seatedRegistrations: 2,
      pendingRegistrations: 2,
    })

    expect((await listAdminMuns({ q: organizer.email.toUpperCase() }, sess(ops))).results.map((r) => r.id)).toEqual([
      mun.id,
    ])
    expect((await listAdminMuns({ q: mun.slug }, sess(ops))).results.map((r) => r.id)).toEqual([mun.id])
  })

  it('filters by status and treats LIKE wildcards literally', async () => {
    const admin = await makeUser('ADMIN')
    const marker = `Wild_${crypto.randomUUID()}`
    const organizer = await makeUser('ORGANIZER')
    const draft = await makeMun(organizer.id, 'DRAFT', `${marker} draft`)
    const live = await makeMun(organizer.id, 'PUBLISHED', `${marker} live`)

    const published = await listAdminMuns({ q: marker, status: 'PUBLISHED' }, sess(admin))
    expect(published.results.map((r) => r.id)).toEqual([live.id])

    const all = await listAdminMuns({ q: marker }, sess(admin))
    expect(all.results.map((r) => r.id).sort()).toEqual([draft.id, live.id].sort())

    // "_" must not match an arbitrary character.
    const underscoreAsWildcard = await listAdminMuns({ q: marker.replace('_', 'X') }, sess(admin))
    expect(underscoreAsWildcard.total).toBe(0)
  })

  it('filters by organizerId as an exact match, unlike a q substring match on email', async () => {
    const admin = await makeUser('ADMIN')
    const organizerA = await makeUser('ORGANIZER', `OrgA-${crypto.randomUUID()}`)
    const organizerB = await makeUser('ORGANIZER', `OrgB-${crypto.randomUUID()}`)
    const munA = await makeMun(organizerA.id, 'DRAFT')
    await makeMun(organizerA.id, 'PUBLISHED')
    await makeMun(organizerB.id, 'DRAFT')

    const filtered = await listAdminMuns({ organizerId: organizerA.id }, sess(admin))
    expect(filtered.total).toBe(2)
    expect(filtered.results.every((r) => r.organizerId === organizerA.id)).toBe(true)

    const combined = await listAdminMuns({ organizerId: organizerA.id, status: 'DRAFT' }, sess(admin))
    expect(combined.results.map((r) => r.id)).toEqual([munA.id])
  })

  it.each(['STUDENT', 'ORGANIZER'] as const)('refuses a %s session', async (role) => {
    const user = await makeUser(role)
    await expect(listAdminMuns({}, sess(user))).rejects.toThrow('Forbidden')
  })
})

describe('getAdminMunDetail', () => {
  it('returns status, modules, submission, payment state and merged history without ciphertext', async () => {
    const admin = await makeUser('ADMIN', 'Reviewer Rae')
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'VERIFICATION')
    await db.insert(organizerApplications).values({ organizerId: organizer.id, munId: mun.id, status: 'APPROVED' })
    await addRegistrations(mun.id, ['CONFIRMED'])
    await db.insert(munModuleVerifications).values({
      munId: mun.id,
      moduleName: 'BRANDING',
      state: 'VERIFIED',
      completionStatus: 'COMPLETE',
      isRequired: false,
      completionPercentage: 100,
      lastReviewedAt: new Date(),
      lastReviewedBy: admin.id,
    })
    const submission = await addSubmission(mun.id, organizer.id, 'UNDER_REVIEW', { reviewerId: admin.id })
    await addPaymentSettings(mun.id, 'PENDING')
    await db.insert(verificationLogs).values({
      munId: mun.id,
      reviewerId: admin.id,
      action: 'VERIFICATION',
      notes: 'claimed',
      internalNotes: 'ops only',
      createdAt: new Date(Date.now() - 60_000),
    })
    await db.insert(adminActions).values([
      {
        actorId: admin.id,
        action: 'MUN_CHANGES_REQUESTED',
        targetType: 'mun_submission',
        targetId: submission.id,
        reason: 'fix logo',
        metadata: { munId: mun.id },
        createdAt: new Date(Date.now() - 30_000),
      },
      { actorId: admin.id, action: 'PAYMENT_DETAILS_CHANGED', targetType: 'mun_payment_settings', targetId: mun.id },
    ])
    // An unrelated MUN's action must not leak into this history.
    const other = await makeMun(organizer.id, 'DRAFT')
    await db.insert(adminActions).values({ actorId: admin.id, action: 'MUN_SUSPENDED', targetType: 'mun', targetId: other.id })

    const detail = await getAdminMunDetail(mun.id, sess(admin))

    expect(detail.mun).toMatchObject({ id: mun.id, status: 'VERIFICATION' })
    expect(detail.organizer).toMatchObject({ id: organizer.id, email: organizer.email, suspended: false })
    expect(detail.application?.status).toBe('APPROVED')
    expect(detail.registrationCounts.CONFIRMED).toBe(1)
    expect(detail.registrationCounts.CANCELLED).toBe(0)

    expect(detail.modules.map((m) => m.moduleName)).toEqual(MODULE_REGISTRY.map((m) => m.key))
    expect(detail.modules.find((m) => m.moduleName === 'BRANDING')).toMatchObject({
      state: 'VERIFIED',
      isRequired: false,
      completionStatus: 'COMPLETE',
      lastReviewedByName: 'Reviewer Rae',
    })
    expect(detail.modules.find((m) => m.moduleName === 'SCHEDULE')).toMatchObject({
      state: 'NOT_SUBMITTED',
      completionStatus: 'NOT_STARTED',
      // SCHEDULE is defaultRequired: false as of the minimum-required-fields cut.
      isRequired: false,
    })

    expect(detail.submission).toMatchObject({
      id: submission.id,
      status: 'UNDER_REVIEW',
      active: true,
      reviewerName: 'Reviewer Rae',
      slaState: 'ON_TRACK',
    })
    expect(detail.paymentSettings).toMatchObject({ verificationState: 'PENDING', verifiedByName: null })
    expect(JSON.stringify(detail)).not.toContain('ciphertext')

    expect(detail.history.map((h) => h.action)).toEqual(['PAYMENT_DETAILS_CHANGED', 'MUN_CHANGES_REQUESTED', 'VERIFICATION'])
    expect(detail.history[2]).toMatchObject({ source: 'lifecycle', internalNotes: 'ops only', actorName: 'Reviewer Rae' })
    expect(detail.history[1]).toMatchObject({ source: 'admin_action', notes: 'fix logo' })
  })

  it('reports a closed submission as inactive with a completed SLA, and null payment settings', async () => {
    const ops = await makeUser('OPERATIONS')
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'PUBLISHED')
    await addSubmission(mun.id, organizer.id, 'PUBLISHED', { slaDeadline: new Date(Date.now() - 1000) })

    const detail = await getAdminMunDetail(mun.id, sess(ops))
    expect(detail.submission).toMatchObject({ active: false, slaState: 'COMPLETED', reviewerName: null })
    expect(detail.paymentSettings).toBeNull()
    expect(detail.application).toBeNull()
  })

  it('throws Mun not found for an unknown id and Forbidden for non-staff', async () => {
    const admin = await makeUser('ADMIN')
    const organizer = await makeUser('ORGANIZER')
    const mun = await makeMun(organizer.id, 'DRAFT')

    await expect(getAdminMunDetail(crypto.randomUUID(), sess(admin))).rejects.toThrow('Mun not found')
    await expect(getAdminMunDetail(mun.id, sess(organizer))).rejects.toThrow('Forbidden')
  })
})

describe('getGoLiveQueueDetails', () => {
  it('adds reviewer, organizer and payment-account state to the queue rows', async () => {
    const admin = await makeUser('ADMIN', 'Queue Reviewer')
    const organizer = await makeUser('ORGANIZER', 'Queue Organizer')
    const reviewed = await makeMun(organizer.id, 'VERIFICATION')
    const unreviewed = await makeMun(organizer.id, 'VERIFICATION')
    const reviewedSubmission = await addSubmission(reviewed.id, organizer.id, 'UNDER_REVIEW', { reviewerId: admin.id })
    const unreviewedSubmission = await addSubmission(unreviewed.id, organizer.id, 'SUBMITTED')
    await addPaymentSettings(reviewed.id, 'VERIFIED')

    // The queue is platform-wide and newest first; a page of 100 comfortably
    // contains the two rows this test just created.
    const { results, total } = await getGoLiveQueueDetails({ limit: 100 }, sess(admin))
    expect(total).toBeGreaterThanOrEqual(2)

    expect(results.find((r) => r.submissionId === reviewedSubmission.id)).toMatchObject({
      munId: reviewed.id,
      reviewerId: admin.id,
      reviewerName: 'Queue Reviewer',
      organizerName: 'Queue Organizer',
      paymentVerificationState: 'VERIFIED',
      slaState: 'ON_TRACK',
    })
    expect(results.find((r) => r.submissionId === unreviewedSubmission.id)).toMatchObject({
      reviewerId: null,
      reviewerName: null,
      paymentVerificationState: null,
    })
  })

  it('refuses non-staff', async () => {
    const student = await makeUser('STUDENT')
    await expect(getGoLiveQueueDetails({}, sess(student))).rejects.toThrow('Forbidden')
  })
})

afterAll(async () => {
  await db.$client.end()
})
