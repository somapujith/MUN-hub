/** `GET /admin/reporting/*` — mirrors lib/actions/admin-reporting.ts. */

export interface TrendPoint {
  /** UTC bucket start, `YYYY-MM-DD`. For `week`, the Monday the ISO week starts on. */
  bucket: string;
  value: number;
}

export interface RevenueTrend {
  gross: TrendPoint[];
  net: TrendPoint[];
}

export interface SignupTrend {
  organizers: TrendPoint[];
  delegates: TrendPoint[];
}

export interface ReportingTrends {
  registrations: TrendPoint[];
  revenue: RevenueTrend;
  signups: SignupTrend;
}

export interface RegistrationFunnel {
  started: number;
  confirmed: number;
  cancelled: number;
  conversionRate: number;
}

export interface PaymentFunnel {
  totalPayments: number;
  paid: number;
  failed: number;
  successRate: number;
  exceptionsOpened: number;
  exceptionRate: number;
}

export interface ConversionFunnel {
  registrations: RegistrationFunnel;
  payments: PaymentFunnel;
}

export interface TopConferenceRow {
  munId: string;
  name: string;
  slug: string;
  value: number;
}

export interface TopConferences {
  byRegistrations: TopConferenceRow[];
  byRevenue: TopConferenceRow[];
}

export interface OrganizerLeaderboardRow {
  organizerId: string;
  name: string;
  email: string;
  value: number;
}

export interface OrganizerLeaderboard {
  byConferencesPublished: OrganizerLeaderboardRow[];
  byRevenue: OrganizerLeaderboardRow[];
}

export interface GeographyRow {
  city: string | null;
  country: string | null;
  registrationCount: number;
  revenue: number;
}

export interface PlatformFeeSummaryRow {
  currency: string;
  platformFeeTotal: number;
  platformFeeTaxTotal: number;
  paidPayments: number;
}

export const REPORTING_RANGE_DAYS = [7, 30, 90] as const;
export type ReportingRangeDays = (typeof REPORTING_RANGE_DAYS)[number];
export type TrendGranularity = "day" | "week";
