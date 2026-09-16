import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { studentProfiles, users } from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import type { StudentProfile, StudentProfileInput } from '@/lib/types/student-profile'

/**
 * Reads the signed-in user's onboarding profile, or null if they haven't
 * completed it yet. No ownership param needed beyond the session itself —
 * this only ever reads the caller's own row.
 */
export async function getStudentProfile(session: Session): Promise<StudentProfile | null> {
  const [profile] = await db
    .select()
    .from(studentProfiles)
    .where(eq(studentProfiles.userId, session.userId))
    .limit(1)
  return profile ?? null
}

/**
 * "Profile complete" has no separate boolean flag — it's true iff `phone`
 * and `institution` are set on `users` AND a `student_profiles` row exists
 * (which, by construction, only ever gets inserted with every required
 * column filled in — see `completeStudentProfile`).
 */
export async function isProfileComplete(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ phone: users.phone, institution: users.institution })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user || !user.phone?.trim() || !user.institution?.trim()) {
    return false
  }

  const [profile] = await db
    .select({ id: studentProfiles.id })
    .from(studentProfiles)
    .where(eq(studentProfiles.userId, userId))
    .limit(1)

  return Boolean(profile)
}

function required(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${label} is required`)
  }
  return trimmed
}

/**
 * Creates or updates the signed-in user's onboarding profile — a plain
 * upsert on `userId`, so the same action serves both "complete your profile
 * for the first time" and "edit your profile" later. Also backfills
 * `users.phone`/`users.institution`, which is where the registration funnel
 * (`app/register/[slug]/page.tsx`) already reads them from.
 *
 * All manual `if`/`required()` checks rather than zod — matches this
 * codebase's convention of validating with zod only at the Hono HTTP
 * boundary and by hand inside `lib/actions`/Next server actions (see
 * `lib/actions/registration-form.ts`).
 *
 * Throws a plain `Error` with a human-readable message for the first missing
 * required field — the caller (a Next server action) surfaces it directly.
 */
export async function completeStudentProfile(
  input: StudentProfileInput,
  session: Session,
): Promise<StudentProfile> {
  const phone = required(input.phone, 'Phone number')
  const institution = required(input.institution, 'School or institution')
  const gradeOrYear = required(input.gradeOrYear, 'Grade / year')
  const residentialAddress = required(input.residentialAddress, 'Residential address')
  const emergencyContactName = required(input.emergencyContactName, 'Emergency contact name')
  const emergencyContactPhone = required(input.emergencyContactPhone, 'Emergency contact phone')
  const emergencyContactRelation = required(
    input.emergencyContactRelation,
    'Emergency contact relation',
  )

  if (!input.dateOfBirth.trim()) {
    throw new Error('Date of birth is required')
  }
  const dateOfBirth = new Date(input.dateOfBirth)
  if (Number.isNaN(dateOfBirth.getTime())) {
    throw new Error('Date of birth is invalid')
  }

  const munExperience = input.munExperience?.trim() || null
  const referralCode = input.referralCode?.trim() || null

  const [profile] = await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ phone, institution })
      .where(eq(users.id, session.userId))

    return tx
      .insert(studentProfiles)
      .values({
        userId: session.userId,
        dateOfBirth,
        gradeOrYear,
        residentialAddress,
        requiresTransportation: input.requiresTransportation,
        emergencyContactName,
        emergencyContactPhone,
        emergencyContactRelation,
        munExperience,
        referralCode,
      })
      .onConflictDoUpdate({
        target: studentProfiles.userId,
        set: {
          dateOfBirth,
          gradeOrYear,
          residentialAddress,
          requiresTransportation: input.requiresTransportation,
          emergencyContactName,
          emergencyContactPhone,
          emergencyContactRelation,
          munExperience,
          referralCode,
          updatedAt: new Date(),
        },
      })
      .returning()
  })

  return profile
}

/**
 * Maps the profile onto the same `fieldKey`s used by
 * `DEFAULT_REGISTRATION_FIELDS` (lib/actions/registration-form-defaults.ts),
 * so the per-mun registration form can pre-fill matching questions instead
 * of asking a returning student to retype them. The per-mun form stays
 * authoritative — this only seeds initial values; the organizer's own
 * required/optional/label configuration for that field is untouched.
 *
 * Returns `{}` if the profile doesn't exist yet — a fresh account with no
 * profile simply gets no pre-fill, same as before this feature existed.
 */
export async function getProfileFormDefaults(session: Session): Promise<Record<string, string>> {
  const profile = await getStudentProfile(session)
  if (!profile) return {}

  return {
    grade_class: profile.gradeOrYear,
    residential_address: profile.residentialAddress,
    transportation: profile.requiresTransportation ? 'Yes' : 'No',
    date_of_birth: profile.dateOfBirth.toISOString().slice(0, 10),
    referral_code: profile.referralCode ?? '',
    emergency_contact_name: profile.emergencyContactName,
    emergency_contact_phone: profile.emergencyContactPhone,
    mun_experience: profile.munExperience ?? '',
  }
}
