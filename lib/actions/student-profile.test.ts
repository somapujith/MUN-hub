import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { studentProfiles, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import type { StudentProfileInput } from '@/lib/types/student-profile'
import {
  completeStudentProfile,
  getProfileFormDefaults,
  getStudentProfile,
  isProfileComplete,
} from './student-profile'

async function createTestUser() {
  const email = `student-profile-${Date.now()}-${Math.random()}@test.com`
  const [user] = await db.insert(users).values({ name: 'Test Student', email, role: 'STUDENT' }).returning()
  const session: Session = { userId: user.id, role: 'STUDENT' }
  return { user, session }
}

const validInput: StudentProfileInput = {
  phone: '9876543210',
  institution: 'Test High School',
  dateOfBirth: '2008-05-14',
  gradeOrYear: '12th Grade',
  residentialAddress: '123 Test Street, Test City',
  requiresTransportation: true,
  emergencyContactName: 'Jane Doe',
  emergencyContactPhone: '9123456789',
  emergencyContactRelation: 'Mother',
  munExperience: '2 conferences',
  referralCode: 'FRIEND10',
}

describe('isProfileComplete', () => {
  it('returns false for a freshly created user', async () => {
    const { user } = await createTestUser()

    await expect(isProfileComplete(user.id)).resolves.toBe(false)
  })

  it('returns true after completeStudentProfile', async () => {
    const { user, session } = await createTestUser()

    await completeStudentProfile(validInput, session)

    await expect(isProfileComplete(user.id)).resolves.toBe(true)
  })
})

describe('completeStudentProfile', () => {
  it('updates users.phone/users.institution to match the input', async () => {
    const { user, session } = await createTestUser()

    await completeStudentProfile(validInput, session)

    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    expect(row.phone).toBe(validInput.phone)
    expect(row.institution).toBe(validInput.institution)
  })

  it('upserts on a second call with different values instead of creating a second row', async () => {
    const { user, session } = await createTestUser()

    await completeStudentProfile(validInput, session)
    await completeStudentProfile(
      { ...validInput, residentialAddress: '456 New Street, New City', emergencyContactName: 'John Doe' },
      session,
    )

    const profile = await getStudentProfile(session)
    expect(profile?.residentialAddress).toBe('456 New Street, New City')
    expect(profile?.emergencyContactName).toBe('John Doe')

    const rows = await db.select().from(studentProfiles).where(eq(studentProfiles.userId, user.id))
    expect(rows.length).toBe(1)
  })

  it('throws "Emergency contact name is required" when emergencyContactName is empty', async () => {
    const { session } = await createTestUser()

    await expect(
      completeStudentProfile({ ...validInput, emergencyContactName: '' }, session),
    ).rejects.toThrow('Emergency contact name is required')
  })

  it('throws "Date of birth is required" when dateOfBirth is empty', async () => {
    const { session } = await createTestUser()

    await expect(completeStudentProfile({ ...validInput, dateOfBirth: '' }, session)).rejects.toThrow(
      'Date of birth is required',
    )
  })

  it('throws "Date of birth is invalid" for an unparseable dateOfBirth', async () => {
    const { session } = await createTestUser()

    await expect(
      completeStudentProfile({ ...validInput, dateOfBirth: 'not-a-date' }, session),
    ).rejects.toThrow('Date of birth is invalid')
  })
})

describe('getProfileFormDefaults', () => {
  it('returns {} before any profile exists', async () => {
    const { session } = await createTestUser()

    await expect(getProfileFormDefaults(session)).resolves.toEqual({})
  })

  it('returns the 8 expected keys with values matching the input after completeStudentProfile', async () => {
    const { session } = await createTestUser()

    await completeStudentProfile(validInput, session)
    const defaults = await getProfileFormDefaults(session)

    expect(defaults).toEqual({
      grade_class: validInput.gradeOrYear,
      residential_address: validInput.residentialAddress,
      transportation: 'Yes',
      date_of_birth: '2008-05-14',
      referral_code: validInput.referralCode,
      emergency_contact_name: validInput.emergencyContactName,
      emergency_contact_phone: validInput.emergencyContactPhone,
      mun_experience: validInput.munExperience,
    })
  })

  it('returns "" (not null/undefined) for munExperience/referralCode when omitted', async () => {
    const { session } = await createTestUser()
    const { munExperience, referralCode, ...withoutOptional } = validInput

    await completeStudentProfile(withoutOptional, session)
    const defaults = await getProfileFormDefaults(session)

    expect(defaults.mun_experience).toBe('')
    expect(defaults.referral_code).toBe('')
  })
})

afterAll(async () => {
  await db.$client.end()
})
