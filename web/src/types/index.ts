import type { MunStatus, Role } from "@/types/enums";
import type { FormField } from "@/types/registration-form";

export type {
  MunStatus,
  Role,
  RegistrationStatus,
  PaymentStatus,
} from "@/types/enums";
export type { FormField } from "@/types/registration-form";

/** Card-shaped summary for marketplace listing/search results. */
export interface MunSummary {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  country: string | null;
  startDate: Date | null;
  endDate: Date | null;
  registrationOpensAt: Date | null;
  registrationDeadline: Date | null;
  status: MunStatus;
  minPrice: number | null;
  /** URL of the MUN's cover image, or null when none has been uploaded. */
  coverImage: string | null;
  organizerName: string | null;
}

export interface Portfolio {
  id: string;
  committeeId: string;
  name: string;
  country: string | null;
  capacity: number;
  /** Remaining seats for this portfolio (schema: integer, default 1). */
  availability: number;
  /** Free-text portfolio type (country, person, press...), when the organizer set one. */
  type?: string | null;
  description?: string | null;
  restrictions?: string | null;
}

export interface Committee {
  id: string;
  munId: string;
  name: string;
  abbreviation: string | null;
  description: string | null;
  capacity: number;
  agenda?: string | null;
  committeeType?: string | null;
}

export interface CommitteeWithPortfolios extends Committee {
  portfolios: Portfolio[];
}

export interface RegistrationProduct {
  id: string;
  munId: string;
  name: string;
  description: string | null;
  price: number;
  /** ISO currency code (the server defaults to INR). */
  currency?: string;
  capacity: number;
  deadline: Date | null;
  isActive: boolean;
  /** Early-bird price, charged instead of `price` until `earlyBirdDeadline`. */
  earlyBirdPrice?: number | null;
  earlyBirdDeadline?: Date | null;
  /** Group/delegation registration gate (2026-09-17) — see web/src/pages/register/group-register-page.tsx. */
  allowsDelegation?: boolean;
}

/** Official, public contact channels of a MUN (never the organizer's contact person). */
export interface PublicMunContact {
  officialEmail: string;
  phone: string | null;
  website: string | null;
}

/**
 * Public MUN detail — mirrors `PublicMunDetail` in lib/types/mun.ts (GET
 * /muns/:slug). There is deliberately no organizer id: the endpoint never
 * sends one.
 */
export interface MunDetail {
  id: string;
  name: string;
  slug: string;
  edition: string | null;
  theme: string | null;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
  venue: string | null;
  addressLine1: string | null;
  city: string | null;
  addressState: string | null;
  postalCode: string | null;
  country: string | null;
  /** Organizer-supplied map link, or null. */
  mapUrl: string | null;
  conferenceType: string | null;
  targetParticipantType: string | null;
  registrationOpensAt: Date | null;
  registrationDeadline: Date | null;
  /** PROVIDED | NOT_PROVIDED | null (not answered yet). */
  accommodationProvided: string | null;
  status: MunStatus;
  committees: CommitteeWithPortfolios[];
  registrationProducts: RegistrationProduct[];
  organizerName: string | null;
  /** URL of the cover image, or null. */
  coverImage: string | null;
  /** URL of the logo, or null. */
  logo: string | null;
  contact: PublicMunContact | null;
  /**
   * The organizer's configured registration questions. Already served by
   * GET /muns/:slug — it was just never declared here, so the registration
   * page couldn't see it and asked four hardcoded questions instead.
   */
  formFields: FormField[];
}

export interface Session {
  userId: string;
  role: Role;
}

export interface MunSearchResult {
  results: MunSummary[];
  total: number;
}

/** Shape consumed by dashboard registration cards (mirrors lib/actions/student-dashboard). */
export interface RegistrationWithMun {
  id: string;
  status: import("@/types/enums").RegistrationStatus;
  registrationProductId: string;
  committeeId: string | null;
  portfolioId: string | null;
  userId: string;
  expiresAt: Date | null;
  mun: {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    country: string | null;
    startDate: Date | null;
    endDate: Date | null;
    /** The conference's lifecycle status, where the source provides it (the dashboard lists do). */
    status?: MunStatus;
  };
  committee: { name: string } | null;
  portfolio: { name: string } | null;
  payment: Array<{ amount: number; currency?: string; status: import("@/types/enums").PaymentStatus }>;
  /** Set only for a group/delegation registration's rows. Null for a solo registration. */
  registrationGroupId?: string | null;
  /** True only for the head delegate's own row in a group registration — gates "Manage your team" (registration-card.tsx). */
  isGroupHead?: boolean;
}

export interface MockRegistrationDetail extends RegistrationWithMun {
  productName: string;
  productPrice: number;
  /**
   * Which checkout to offer: the provider key (`mock_razorpay` for the dev
   * mock) or null when online payments are unavailable.
   */
  paymentProvider?: string | null;
}

export interface UserProfile {
  name: string;
  email: string;
  phone: string | null;
  institution: string | null;
}

export type SupportCategory =
  | "REGISTRATION"
  | "PAYMENT"
  | "REFUND"
  | "MUN_INFO"
  | "ACCOUNT"
  | "CERTIFICATE"
  | "ORGANIZER"
  | "TECHNICAL"
  | "SAFETY_POLICY";
