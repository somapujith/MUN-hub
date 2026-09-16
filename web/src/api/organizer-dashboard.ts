import type { MunStatus, PaymentStatus } from "@/types/enums";
import type { DelegateListResult } from "@/types/organizer-dashboard";
import type { ScheduleCommittee } from "@/types/mun-schedule";
import type { OrganizerMunSummary, OrganizerWorkspaceTotals } from "@/types/organizer";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface DelegateFilters {
  committeeId?: string;
  paymentStatus?: PaymentStatus;
  limit?: number;
  offset?: number;
}

/** Wraps lib/actions/organizer-dashboard.ts#getDelegateList — session-gated, ownership re-checked server-side. */
export function getDelegateList(munId: string, filters?: DelegateFilters) {
  const params = new URLSearchParams();
  if (filters?.committeeId) params.set("committeeId", filters.committeeId);
  if (filters?.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));
  const qs = params.toString();
  return request<DelegateListResult>(`/organizer/muns/${munId}/delegates${qs ? `?${qs}` : ""}`);
}

/** Public read — reused here for the committee segment filter. */
export function listCommitteesForDelegates(munId: string) {
  return request<ScheduleCommittee[]>(`/muns/${munId}/committees`);
}

/**
 * Wire shape of GET /organizer/workspace/overview
 * (lib/actions/organizer-dashboard.ts#getOrganizerWorkspaceOverview). Dates
 * come back as ISO strings (JSON has no Date type).
 */
interface RawOrganizerWorkspaceMunSummary {
  id: string;
  name: string;
  slug: string;
  edition: string | null;
  status: MunStatus;
  startDate: string | null;
  endDate: string | null;
  registrationCount: number;
  confirmedCount: number;
  capacity: number;
}

interface RawOrganizerWorkspaceOverview {
  muns: RawOrganizerWorkspaceMunSummary[];
  totals: OrganizerWorkspaceTotals;
}

export interface OrganizerWorkspaceOverview {
  muns: OrganizerMunSummary[];
  totals: OrganizerWorkspaceTotals;
}

/**
 * Every mun the signed-in organizer owns plus registration/capacity totals
 * across all of them. Backs both the Overview and My MUNs pages — call it
 * once per page under the same query key (`queryKeys.organizerWorkspace()`)
 * so navigating between the two is a cache hit, not a refetch.
 */
export async function getOrganizerWorkspaceOverview(): Promise<OrganizerWorkspaceOverview> {
  const raw = await request<RawOrganizerWorkspaceOverview>("/organizer/workspace/overview");
  return {
    totals: raw.totals,
    muns: raw.muns.map((mun) => ({
      ...mun,
      startDate: mun.startDate ? new Date(mun.startDate) : null,
      endDate: mun.endDate ? new Date(mun.endDate) : null,
    })),
  };
}
