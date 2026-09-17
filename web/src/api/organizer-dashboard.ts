import type { MunStatus, PaymentStatus, RegistrationStatus } from "@/types/enums";
import type {
  AttendanceStatus,
  AttendanceUpdate,
  DelegateDetail,
  DelegateListResult,
} from "@/types/organizer-dashboard";
import type { ScheduleCommittee } from "@/types/mun-schedule";
import type { OrganizerMunSummary, OrganizerWorkspaceTotals } from "@/types/organizer";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    // Spread options FIRST: spreading them last replaced this merged object
    // whenever a caller passed its own headers, silently dropping Content-Type.
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function toError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return new Error(body?.error?.message ?? `Request failed (${response.status})`);
}

export interface DelegateFilters {
  committeeId?: string;
  paymentStatus?: PaymentStatus;
  /** Registration statuses to include; empty or omitted means all. */
  statuses?: RegistrationStatus[];
  /** Pass (registration product) id. */
  registrationProductId?: string;
  /** Name, email, institution or registration id — searched across the whole roster. */
  search?: string;
  limit?: number;
  offset?: number;
}

/** Longest search the API accepts (lib ROSTER_SEARCH_MAX_LENGTH). */
export const ROSTER_SEARCH_MAX_LENGTH = 100;

function filterParams(filters?: DelegateFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters?.committeeId) params.set("committeeId", filters.committeeId);
  if (filters?.registrationProductId) params.set("registrationProductId", filters.registrationProductId);
  if (filters?.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
  if (filters?.statuses?.length) params.set("status", filters.statuses.join(","));
  const search = filters?.search?.trim();
  if (search) params.set("search", search.slice(0, ROSTER_SEARCH_MAX_LENGTH));
  return params;
}

/** Wraps lib/actions/organizer-dashboard.ts#getDelegateList — session-gated, ownership re-checked server-side. */
export function getDelegateList(munId: string, filters?: DelegateFilters) {
  const params = filterParams(filters);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));
  const qs = params.toString();
  return request<DelegateListResult>(`/organizer/muns/${munId}/delegates${qs ? `?${qs}` : ""}`);
}

export const delegateDetailKey = (munId: string, registrationId: string) =>
  ["organizer", "delegate-detail", munId, registrationId] as const;

/** One delegate's full record for the roster drawer. Owning organizer only. */
export function getDelegateDetail(munId: string, registrationId: string) {
  return request<DelegateDetail>(`/organizer/muns/${munId}/delegates/${registrationId}`);
}

/** Marks a seat-holding delegate attended or no-show (conference active or awaiting results). */
export function setDelegateAttendance(munId: string, registrationId: string, status: AttendanceStatus) {
  return request<AttendanceUpdate>(`/organizer/muns/${munId}/delegates/${registrationId}/attendance`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

/**
 * Downloads the filtered roster as CSV. The file name is built here: the
 * API's Content-Disposition header isn't readable cross-origin without a
 * CORS expose rule, and the browser download needs a name either way.
 */
export async function downloadDelegateRoster(munId: string, fileStem: string, filters?: DelegateFilters) {
  const qs = filterParams(filters).toString();
  const response = await fetch(`${API_BASE_URL}/organizer/muns/${munId}/delegates/export${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  if (!response.ok) throw await toError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileStem}-delegates-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Revoke on the next tick: some browsers start the download asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
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
