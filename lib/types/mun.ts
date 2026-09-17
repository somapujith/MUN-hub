import type { InferSelectModel } from 'drizzle-orm'
import type {
  committees,
  muns,
  organizerApplications,
  portfolios,
  registrationProducts,
  munFormFields,
  verificationLogs,
} from '@/lib/db/schema'
import type { MunStatus } from '@/lib/db/schema-enums'

export type Mun = InferSelectModel<typeof muns>
export type Committee = InferSelectModel<typeof committees>
export type Portfolio = InferSelectModel<typeof portfolios>
export type RegistrationProduct = InferSelectModel<typeof registrationProducts>
export type RegistrationFormField = InferSelectModel<typeof munFormFields>
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
 * plain columns on `muns` — `minPrice` is the cheapest active
 * `registrationProducts` row, `organizerName` comes from the organizer's user
 * row, and `coverImage` is the URL of the mun's COVER `mun_media` item.
 */
export interface MunSummary {
  id: string
  name: string
  slug: string
  city: string | null
  country: string | null
  startDate: Date | null
  endDate: Date | null
  registrationOpensAt: Date | null
  registrationDeadline: Date | null
  status: MunStatus
  /** Cheapest active registration product price for this MUN, or null if none. */
  minPrice: number | null
  /** Cover/banner image URL for marketplace cards, or null if not set. */
  coverImage: string | null
  /** Display name of the organizing user/org, or null if organizer lookup failed. */
  organizerName: string | null
}

/**
 * Internal full-row detail shape (every `muns` column, including
 * `organizerId`). Never send this to an anonymous caller — the public MUN page
 * uses `PublicMunDetail` below.
 */
export interface MunDetail extends Mun {
  committees: CommitteeWithPortfolios[]
  registrationProducts: RegistrationProduct[]
  organizerName: string | null
  formFields: RegistrationFormField[]
}

/**
 * The `muns` columns an anonymous visitor may see — an explicit allowlist.
 * Deliberately excludes `organizerId` and the internal bookkeeping timestamps;
 * a column added to `muns` later stays private until it is added here (and to
 * `PUBLIC_MUN_COLUMNS` in lib/actions/marketplace.ts).
 */
export interface PublicMun {
  id: string
  name: string
  slug: string
  edition: string | null
  theme: string | null
  description: string | null
  startDate: Date | null
  endDate: Date | null
  venue: string | null
  addressLine1: string | null
  city: string | null
  addressState: string | null
  postalCode: string | null
  country: string | null
  mapUrl: string | null
  conferenceType: string | null
  targetParticipantType: string | null
  registrationOpensAt: Date | null
  registrationDeadline: Date | null
  /** PROVIDED | NOT_PROVIDED | null (organizer hasn't answered). */
  accommodationProvided: string | null
  status: MunStatus
}

export type PublicPortfolio = Pick<
  Portfolio,
  'id' | 'committeeId' | 'name' | 'type' | 'availability' | 'description' | 'restrictions'
>

export interface PublicCommittee
  extends Pick<
    Committee,
    'id' | 'munId' | 'name' | 'agenda' | 'description' | 'capacity' | 'committeeType' | 'portfoliosEnabled'
  > {
  portfolios: PublicPortfolio[]
}

export type PublicRegistrationProduct = Omit<RegistrationProduct, 'createdAt'>

/**
 * The official, public-facing contact channels of a MUN. The named contact
 * person (name/email/phone) on `mun_contacts` is organizer-internal and is
 * never part of this shape.
 */
export interface PublicMunContact {
  officialEmail: string
  phone: string | null
  website: string | null
}

/** Shape returned by `getMunBySlug` — everything the public MUN page and the registration funnel read. */
export interface PublicMunDetail extends PublicMun {
  committees: PublicCommittee[]
  registrationProducts: PublicRegistrationProduct[]
  organizerName: string | null
  /** URL of the COVER media item, or null. */
  coverImage: string | null
  /** URL of the LOGO media item, or null. */
  logo: string | null
  contact: PublicMunContact | null
  formFields: RegistrationFormField[]
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
