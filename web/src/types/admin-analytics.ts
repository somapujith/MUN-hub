import type { RegistrationStatus } from "@/types/enums";

/** `GET /admin/analytics` — mirrors lib/actions/admin-analytics.ts. */
export interface RevenueByCurrency {
  currency: string;
  gmv: number;
  platformFeeTotal: number;
  paidPayments: number;
  paidPaymentsWithoutFeeBreakdown: number;
}

export interface AdminAnalytics {
  revenue: RevenueByCurrency[];
  registrationsByStatus: Record<RegistrationStatus, number>;
  liveMuns: number;
  newOrganizersLast7Days: number;
  generatedAt: string;
}
