import type {
  ConversionFunnel,
  GeographyRow,
  OrganizerLeaderboard,
  PlatformFeeSummaryRow,
  ReportingRangeDays,
  ReportingTrends,
  TopConferences,
  TrendGranularity,
} from "@/types/admin-reporting";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    // Spread options FIRST: spreading them last replaced this merged object
    // whenever a caller passed its own headers, silently dropping Content-Type.
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface ReportingRangeParams {
  days: ReportingRangeDays;
}

export interface ReportingTrendsParams extends ReportingRangeParams {
  granularity: TrendGranularity;
}

/** Registration, revenue and signup trends over the range (`GET /admin/reporting/trends`). */
export function getReportingTrends(params: ReportingTrendsParams) {
  return request<ReportingTrends>(`/admin/reporting/trends?days=${params.days}&granularity=${params.granularity}`);
}

/** Registration and payment conversion funnel (`GET /admin/reporting/funnel`). */
export function getConversionFunnel(params: ReportingRangeParams) {
  return request<ConversionFunnel>(`/admin/reporting/funnel?days=${params.days}`);
}

/** Top 10 conferences by registrations and by revenue (`GET /admin/reporting/top-conferences`). */
export function getTopConferences(params: ReportingRangeParams) {
  return request<TopConferences>(`/admin/reporting/top-conferences?days=${params.days}`);
}

/** Top 10 organizers by conferences published and by revenue (`GET /admin/reporting/organizers`). */
export function getOrganizerLeaderboard(params: ReportingRangeParams) {
  return request<OrganizerLeaderboard>(`/admin/reporting/organizers?days=${params.days}`);
}

/** Registrations and revenue by city (`GET /admin/reporting/geography`). */
export function getGeographyBreakdown(params: ReportingRangeParams) {
  return request<GeographyRow[]>(`/admin/reporting/geography?days=${params.days}`);
}

/** Platform fee (and GST) collected, per currency (`GET /admin/reporting/fees`). */
export function getPlatformFeeSummary(params: ReportingRangeParams) {
  return request<PlatformFeeSummaryRow[]>(`/admin/reporting/fees?days=${params.days}`);
}
