import { describe, expect, it } from 'vitest'
import { REGISTRATION_ERRORS } from '@/lib/actions/registration'
import { completeStudentProfile } from '@/lib/actions/student-profile'
import { db } from '@/lib/db/client'
import { committees, muns, registrationProducts } from '@/lib/db/schema'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

async function makeMun(status: (typeof muns.$inferInsert)['status']) {
  const organizer = await makeUser('ORGANIZER')
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Eligibility Mun', slug: `elig-${crypto.randomUUID()}`, status })
    .returning()
  const [pass] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate', price: 1000, capacity: 10 })
    .returning()
  return { mun, pass }
}

async function makeStudent(completeProfile: boolean) {
  const student = await makeUser('STUDENT')
  if (completeProfile) {
    await completeStudentProfile(
      {
        phone: '9876501234',
        institution: 'Test College',
        dateOfBirth: '2004-06-15',
        gradeOrYear: '3rd year',
        residentialAddress: '1 Test Lane',
        requiresTransportation: false,
        emergencyContactName: 'Guardian',
        emergencyContactPhone: '9876505678',
        emergencyContactRelation: 'Parent',
      },
      { userId: student.id, role: 'STUDENT' },
    )
  }
  return authHeaders(student.id)
}

function register(headers: Record<string, string>, body: Record<string, unknown>) {
  return app.request('/api/v1/registrations', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  })
}

describe('POST /registrations eligibility', () => {
  it('refuses a student whose profile is incomplete with a clear 409', async () => {
    const { mun, pass } = await makeMun('REGISTRATION_OPEN')
    const res = await register(await makeStudent(false), { munId: mun.id, registrationProductId: pass.id })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toEqual({ code: 'CONFLICT_STATE', message: REGISTRATION_ERRORS.profileIncomplete })
  })

  it('lets a student with a complete profile register on an open mun', async () => {
    const { mun, pass } = await makeMun('REGISTRATION_OPEN')
    const res = await register(await makeStudent(true), { munId: mun.id, registrationProductId: pass.id })
    expect(res.status).toBe(201)
  })

  it('maps "not open" to 409 CONFLICT_STATE', async () => {
    const { mun, pass } = await makeMun('PUBLISHED')
    const res = await register(await makeStudent(true), { munId: mun.id, registrationProductId: pass.id })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toEqual({ code: 'CONFLICT_STATE', message: REGISTRATION_ERRORS.notOpen })
  })

  it('maps a foreign pass or committee to 400 VALIDATION_FAILED', async () => {
    const open = await makeMun('REGISTRATION_OPEN')
    const other = await makeMun('REGISTRATION_OPEN')
    const headers = await makeStudent(true)

    const wrongPass = await register(headers, { munId: open.mun.id, registrationProductId: other.pass.id })
    expect(wrongPass.status).toBe(400)
    expect((await wrongPass.json()).error.message).toBe(REGISTRATION_ERRORS.passWrongMun)

    const [foreignCommittee] = await db
      .insert(committees)
      .values({ munId: other.mun.id, name: 'Foreign', capacity: 10 })
      .returning()
    const wrongCommittee = await register(headers, {
      munId: open.mun.id,
      registrationProductId: open.pass.id,
      committeeId: foreignCommittee.id,
    })
    expect(wrongCommittee.status).toBe(400)
    expect((await wrongCommittee.json()).error.code).toBe('VALIDATION_FAILED')
  })

  it('maps a full committee to 409 CONFLICT_CAPACITY', async () => {
    const { mun, pass } = await makeMun('REGISTRATION_OPEN')
    const [committee] = await db.insert(committees).values({ munId: mun.id, name: 'Tiny', capacity: 1 }).returning()
    const first = await register(await makeStudent(true), { munId: mun.id, registrationProductId: pass.id, committeeId: committee.id })
    expect(first.status).toBe(201)
    const second = await register(await makeStudent(true), { munId: mun.id, registrationProductId: pass.id, committeeId: committee.id })
    expect(second.status).toBe(409)
    expect((await second.json()).error).toEqual({ code: 'CONFLICT_CAPACITY', message: 'Committee is at capacity' })
  })
})
