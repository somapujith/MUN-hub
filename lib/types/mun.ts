import type { InferSelectModel } from 'drizzle-orm'
import type {
  committees,
  muns,
  organizerApplications,
  portfolios,
  registrationProducts,
  verificationLogs,
} from '@/lib/db/schema'
import type { MunStatus } from '@/lib/db/schema-enums'

export type Mun = InferSelectModel<typeof muns>
export type Committee = InferSelectModel<typeof committees>
export type Portfolio = InferSelectModel<typeof portfolios>
export type RegistrationProduct = InferSelectModel<typeof registrationProducts>
export type OrganizerApplication = InferSelectModel<typeof organizerApplications>
export type VerificationLog = InferSelectModel<typeof verificationLogs>

/** A committee with its portfolios nested — shape returned by `getMunBySlug`. */
export interface CommitteeWithPortfolios extends Committee {
  portfolios: Portfolio[]
}

/**
 * Card-shaped summary for marketplace listing/search results.
 *
 * `minPrice`, `coverImage`, `organizerName` are derived/joined fields, not
 * plain columns on `muns` — callers building this type must compute
 * `minPrice` from the cheapest active `registrationProducts` row, resolve
 * `organizerName` via the `organizer` relation, and resolve `coverImage`
 * once a cover-image column/asset pipeline exists (nullable until then).
 */
export interface MunSummary {
  id: string
  name: string
  slug: string
  city: string | null
  country: string | null
  startDate: Date | null
  endDate: Date | null
  status: MunStatus
  /** Cheapest active registration product price for this MUN, or null if none. */
  minPrice: number | null
  /** Cover/banner image URL for marketplace cards, or null if not set. */
  coverImage: string | null
  /** Display name of the organizing user/org, or null if organizer lookup failed. */
  organizerName: string | null
}

export interface MunDetail extends Mun {
  committees: CommitteeWithPortfolios[]
  registrationProducts: RegistrationProduct[]
  organizerName: string | null
}

/**
 * Ops-only full review detail — shape returned by `getMunForReview`.
 *
 * Unlike the public `MunDetail`, `verificationLogs` here includes
 * `internalNotes`: this type must never be sent to a non-admin/ops surface.
 * `organizerApplication` is null only in the (should-not-happen-in-practice)
 * case where a mun has no linked application row.
 */
export interface MunWithApplication extends Mun {
  organizerApplication: OrganizerApplication | null
  verificationLogs: VerificationLog[]
}
