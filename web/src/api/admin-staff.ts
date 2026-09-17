import type {
  CreateStaffInput,
  CreateStaffResult,
  ListStaffParams,
  ListStaffResult,
  SetPasswordLink,
  StaffRole,
  StaffRow,
} from "@/types/admin-staff";

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

/** Staff directory (`GET /admin/staff`). Any staff role can read it. */
export function listStaff(params: ListStaffParams = {}) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.role) query.set("role", params.role);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return request<ListStaffResult>(`/admin/staff${qs ? `?${qs}` : ""}`);
}

// Every write below is SUPER_ADMIN only on the server.

/**
 * Creates a staff account and returns its one-time set-password link. The
 * link is a credential: show it once, never store it client-side.
 */
export function createStaffAccount(input: CreateStaffInput) {
  return request<CreateStaffResult>("/admin/staff", {
    method: "POST",
    body: JSON.stringify(input),
    cache: "no-store",
  });
}

export function changeStaffRole(userId: string, role: StaffRole) {
  return request<StaffRow>(`/admin/staff/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

/** Blocks sign-in and ends the account's current sessions. */
export function suspendStaff(userId: string, reason: string) {
  return request<StaffRow>(`/admin/staff/${userId}/suspend`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function reinstateStaff(userId: string) {
  return request<StaffRow>(`/admin/staff/${userId}/reinstate`, { method: "POST" });
}

/** Issues a fresh set-password link; older unused links for the account stop working. */
export function issueStaffSetPasswordLink(userId: string) {
  return request<SetPasswordLink>(`/admin/staff/${userId}/set-password-link`, {
    method: "POST",
    cache: "no-store",
  });
}

/** Clears a staff member's TOTP enrollment (e.g. a lost device) so they can re-enroll from scratch. */
export function resetStaffMfa(userId: string) {
  return request<void>(`/admin/staff/${userId}/mfa/reset`, { method: "POST" });
}
