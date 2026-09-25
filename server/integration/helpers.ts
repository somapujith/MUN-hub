import { db } from '@/lib/db/client'
import { organizerProfiles, users } from '@/lib/db/schema'
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth/session'

export async function makeUser(role: 'STUDENT' | 'ORGANIZER' | 'ADMIN' = 'ORGANIZER') {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role}-${crypto.randomUUID()}@test.com`, role })
    .returning()
  return user
}

/**
 * Marks an organizer's onboarding as finished, which applying to host
 * requires. Also sets the bank account fields — the required payout method
 * as of 2026-09-26 — since `open-registration`'s payout gate
 * (`lib/lifecycle/registration-lifecycle.ts#organizerPayoutOnboardingComplete`)
 * checks those, not `upiId`. UPI stays set too, as a realistic optional
 * secondary address.
 */
export async function completeOrganizerOnboarding(userId: string) {
  await db.insert(organizerProfiles).values({
    userId,
    firstName: 'Test',
    lastName: 'Organizer',
    contactPhone: '9876543210',
    accountHolderName: 'Test Organizer',
    bankName: 'Test Bank',
    bankAccountLast4: '4321',
    ifscCode: 'TEST0001234',
    upiId: 'test@freecharge',
    upiPhone: '9876543210',
    agreementVersion: 'test',
    completedAt: new Date(),
  })
}

export async function authHeaders(userId: string): Promise<Record<string, string>> {
  const { token } = await createSession(userId)
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}` }
}
