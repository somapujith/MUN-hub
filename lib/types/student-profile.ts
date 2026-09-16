import type { InferSelectModel } from 'drizzle-orm'
import type { studentProfiles } from '@/lib/db/schema'

export type StudentProfile = InferSelectModel<typeof studentProfiles>

/**
 * Everything `completeStudentProfile` needs. `phone`/`institution` land on
 * `users` (already existed there); everything else is new, on
 * `student_profiles`. `dateOfBirth` is an ISO date string (`<input
 * type="date">` value) rather than a `Date` so this type can be passed
 * straight from a form action without a parsing step at the call site.
 */
export interface StudentProfileInput {
  phone: string
  institution: string
  dateOfBirth: string
  gradeOrYear: string
  residentialAddress: string
  requiresTransportation: boolean
  emergencyContactName: string
  emergencyContactPhone: string
  emergencyContactRelation: string
  munExperience?: string
  referralCode?: string
}
