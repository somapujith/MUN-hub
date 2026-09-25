import type {
  ListOrganizersParams,
  ListOrganizersResult,
  OrganizerBankDetails,
  OrganizerDetail,
  OrganizerPayoutStatus,
  PaymentGateway,
} from "@/types/organizer-admin";

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

export function listOrganizers(params: ListOrganizersParams = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.search) query.set("search", params.search);
  const qs = query.toString();
  return request<ListOrganizersResult>(`/admin/organizers${qs ? `?${qs}` : ""}`);
}

export function suspendOrganizer(userId: string, reason: string) {
  return request<void>(`/admin/organizers/${userId}/suspend`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function reinstateOrganizer(userId: string) {
  return request<void>(`/admin/organizers/${userId}/reinstate`, { method: "POST" });
}

/** Account info + onboarding-wizard answers for one organizer. Powers the admin organizer detail page. */
export function getOrganizerDetail(userId: string) {
  return request<OrganizerDetail>(`/admin/organizers/${userId}`);
}

/**
 * Decrypts and returns the organizer's full bank payout details — every call
 * is audit-logged server-side. Deliberately not a `useQuery` anywhere it's
 * called: fire it only on an explicit "reveal" click, never prefetched or
 * cached under a persistent key, so a viewer who never asks for it never
 * causes a reveal (and its log entry) to happen on their behalf.
 */
export function getOrganizerBankDetails(userId: string) {
  return request<OrganizerBankDetails>(`/admin/organizers/${userId}/bank-details`);
}

/**
 * Ties the organizer to a real payment gateway account and marks their
 * payout verified — wraps lib/actions/organizer-admin.ts#verifyOrganizerPayout.
 * This is the gate that then lets the organizer publish their own MUN
 * without a further admin Gate-2 step (see @/api/go-live's
 * organizerSelfPublish).
 */
export function verifyOrganizerPayout(userId: string, gateway: PaymentGateway) {
  return request<OrganizerPayoutStatus>(`/admin/organizers/${userId}/verify-payout`, {
    method: "POST",
    body: JSON.stringify({ gateway }),
  });
}
