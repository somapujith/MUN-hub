import type { InferSelectModel } from 'drizzle-orm'
import type { studentProfiles } from '@/lib/db/schema'

export type StudentProfile = InferSelectModel<typeof studentProfiles>

/**
 * Everything `completeStudentProfile` needs. `phone`/`institution` land on
 * `users` (already existed there); everything else is new, on
 * `student_profiles`. `dateOfBirth` is an ISO date string (`<input
 * type="date">` value) rather than a `Date` so this type can be passed
 * straight from a form action without a parsing step at the call site.
 *
 * The original required fields stay required here. Every field added for
 * docs/prd/MUNHub_User_Workflow_PRD.md is optional at the TYPE level, even
 * `gender` (which the PRD requires at signup) — that requirement is
 * enforced at runtime inside `signUp` only, not here, because this same
 * type also backs profile *editing* later (`completeStudentProfile`), and a
 * pre-existing profile must stay editable without being forced to backfill
 * a field it was created before. See `lib/actions/student-profile.ts`'s
 * `isProfileComplete` — deliberately unchanged, none of these count toward
 * "complete."
 */
export interface StudentProfileInput {
  phone: string
  institution: string
  dateOfBirth: string
  gradeOrYear: string
  residentialAddress: string
  requiresTransportation?: boolean
  emergencyContactName: string
  emergencyContactPhone: string
  emergencyContactRelation: string
  munExperience?: string
  referralCode?: string
  // --- Optional additions (PRD §9-14) ---
  gender?: string
  preferredName?: string
  nationality?: string
  addressCity?: string
  addressState?: string
  addressCountry?: string
  postalCode?: string
  alternateMobile?: string
  courseOrProgram?: string
  graduationYear?: number
  department?: string
  studentId?: string
  academicEmail?: string
  alternateEmergencyContactName?: string
  alternateEmergencyContactNumber?: string
  alternateEmergencyContactRelation?: string
  hasPriorMunExperience?: boolean
  munsAttendedCount?: number
  previousAchievements?: string
  bio?: string
  areasOfInterest?: string[]
  languages?: string[]
  isPublicProfileVisible?: boolean
}
