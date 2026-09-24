import type {
  AdminRegistrationCancelResult,
  AdminRegistrationDuplicateFlagResult,
  AdminRegistrationResendResult,
  AdminRegistrationRow,
  AdminRegistrationsQueueResult,
} from "@/types/admin-registrations";
import type { RegistrationStatus } from "@/types/enums";

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

export interface AdminRegistrationsFilters {
  q?: string;
  status?: RegistrationStatus;
  munId?: string;
}

export interface AdminRegistrationsQueueParams extends AdminRegistrationsFilters {
  limit?: number;
  offset?: number;
}

interface RawAdminRegistrationRow extends Omit<AdminRegistrationRow, "createdAt" | "flaggedDuplicateAt"> {
  createdAt: string;
  flaggedDuplicateAt: string | null;
}

interface RawAdminRegistrationsQueueResult {
  results: RawAdminRegistrationRow[];
  total: number;
}

function filterParams(filters: AdminRegistrationsFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.munId) params.set("munId", filters.munId);
  return params;
}

function toRow(row: RawAdminRegistrationRow): AdminRegistrationRow {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    flaggedDuplicateAt: row.flaggedDuplicateAt ? new Date(row.flaggedDuplicateAt) : null,
  };
}

/**
 * Platform-wide, paginated registrations browse with optional `?q=`/`?status=`/
 * `?munId=` filters — wraps `/admin/registrations` (server/routes/admin.ts,
 * backed by `lib/actions/admin-review.ts#getRegistrationsQueue`). Distinct
 * from the `/admin/search/registrations` endpoint, which requires a
 * non-empty query and has no pagination.
 */
export async function getRegistrationsQueue(
  params: AdminRegistrationsQueueParams = {},
): Promise<AdminRegistrationsQueueResult> {
  const query = filterParams(params);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();

  const raw = await request<RawAdminRegistrationsQueueResult>(
    `/admin/registrations${qs ? `?${qs}` : ""}`,
  );
  return { total: raw.total, results: raw.results.map(toRow) };
}

/** Admin-initiated cancel of one registration — releases its seat. The reason is required and goes into the audit log. */
export function cancelRegistration(registrationId: string, reason: string) {
  return request<AdminRegistrationCancelResult>(
    `/admin/registrations/${encodeURIComponent(registrationId)}/cancel`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

/** Flags a registration as a suspected duplicate. The reason is required and goes into the audit log. */
export function flagRegistrationDuplicate(registrationId: string, reason: string) {
  return request<AdminRegistrationDuplicateFlagResult>(
    `/admin/registrations/${encodeURIComponent(registrationId)}/flag-duplicate`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

/** Clears a registration's duplicate flag. */
export function unflagRegistrationDuplicate(registrationId: string) {
  return request<AdminRegistrationDuplicateFlagResult>(
    `/admin/registrations/${encodeURIComponent(registrationId)}/unflag-duplicate`,
    { method: "POST" },
  );
}

/** Re-sends the registration-confirmed email through the same pipeline the original confirmation used. */
export function resendRegistrationConfirmation(registrationId: string) {
  return request<AdminRegistrationResendResult>(
    `/admin/registrations/${encodeURIComponent(registrationId)}/resend-confirmation`,
    { method: "POST" },
  );
}

/**
 * Downloads the filtered registrations queue as CSV. The file name is built
 * here: the API's Content-Disposition header isn't readable cross-origin
 * without a CORS expose rule, and the browser download needs a name either
 * way (mirrors organizer-dashboard.ts's `downloadDelegateRoster`).
 */
export async function downloadRegistrationsCsv(filters: AdminRegistrationsFilters = {}) {
  const qs = filterParams(filters).toString();
  const response = await fetch(`${API_BASE_URL}/admin/registrations/export${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  if (!response.ok) throw await toError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `registrations-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Revoke on the next tick: some browsers start the download asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
