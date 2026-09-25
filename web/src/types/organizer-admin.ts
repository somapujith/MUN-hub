export interface OrganizerRow {
  id: string;
  name: string;
  email: string;
  institution: string | null;
  suspended: boolean;
  suspendedReason: string | null;
  suspendedAt: string | null;
  createdAt: string;
  /** How many MUNs this organizer runs (any status). Links through to the Conferences console. */
  munCount: number;
}

export interface ListOrganizersResult {
  results: OrganizerRow[];
  total: number;
}

export interface ListOrganizersParams {
  limit?: number;
  offset?: number;
  search?: string;
}

/** Decrypted, full detail — see `getOrganizerBankDetails` in `@/api/organizer-admin` before adding another caller. */
export interface OrganizerBankDetails {
  accountHolderName: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  ifscCode: string | null;
  upiId: string | null;
  upiPhone: string | null;
}

/** Mirrors lib/actions/organizer-admin.ts's PAYMENT_GATEWAY_OPTIONS — keep in sync. */
export const PAYMENT_GATEWAY_OPTIONS = ["CASHFREE", "MANUAL"] as const;
export type PaymentGateway = (typeof PAYMENT_GATEWAY_OPTIONS)[number];

export interface OrganizerPayoutStatus {
  payoutVerified: boolean;
  paymentGateway: string | null;
  payoutVerifiedAt: string | null;
}

/** Onboarding-wizard answers plus payout-verification status for one organizer — see `getOrganizerDetail`. */
export interface OrganizerProfileDetail {
  firstName: string | null;
  lastName: string | null;
  contactPhone: string | null;
  munName: string | null;
  munCity: string | null;
  /** ISO date (YYYY-MM-DD). */
  munStartDate: string | null;
  expectedDelegateCount: number | null;
  munDescription: string | null;
  previousEditions: string | null;
  websiteUrl: string | null;
  agreementVersion: string | null;
  completedAt: string | null;
  payoutVerified: boolean;
  paymentGateway: string | null;
  payoutVerifiedAt: string | null;
}

/**
 * Account info + onboarding answers for the admin organizer detail page.
 * Deliberately excludes the bank account number itself (see
 * `OrganizerBankDetails`, revealed separately).
 */
export interface OrganizerDetail {
  id: string;
  name: string;
  email: string;
  institution: string | null;
  suspended: boolean;
  suspendedReason: string | null;
  suspendedAt: string | null;
  createdAt: string;
  profile: OrganizerProfileDetail | null;
}
