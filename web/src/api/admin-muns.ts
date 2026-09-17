import type { AdminMunDetail, AdminMunListParams, AdminMunListResult } from "@/types/admin-muns";
import type { MunStatus } from "@/types/enums";

/** The trimmed mun row the visibility actions return. */
interface MunStatusRow {
  id: string;
  name: string;
  slug: string;
  status: MunStatus;
}

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

/** Every MUN on the platform (`GET /admin/muns`, lib/actions/admin-muns.ts#listAdminMuns). Staff only. */
export function listAdminMuns(params: AdminMunListParams = {}) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status) query.set("status", params.status);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return request<AdminMunListResult>(`/admin/muns${qs ? `?${qs}` : ""}`);
}

/** Staff view of one MUN (`GET /admin/muns/:munId`). SLA state is computed on read, so never cached. */
export function getAdminMunDetail(munId: string) {
  return request<AdminMunDetail>(`/admin/muns/${munId}`, { cache: "no-store" });
}

// The four visibility actions below are ADMIN/SUPER_ADMIN only on the server
// (lib/actions/admin-review.ts); the UI hides them from OPERATIONS.

/**
 * VERIFIED (no active submission) or GO_LIVE_QUEUE -> PUBLISHED
 * (`publishMun`, which delegates to the idempotent `publishFromQueue` when the
 * MUN has an active submission).
 */
export function publishMun(munId: string) {
  return request<MunStatusRow>(`/admin/muns/${munId}/publish`, { method: "POST" });
}

/** PUBLISHED -> UNPUBLISHED (off the marketplace, content unchanged). */
export function unpublishMun(munId: string) {
  return request<MunStatusRow>(`/admin/muns/${munId}/unpublish`, { method: "POST" });
}

/** Live MUN -> SUSPENDED. The reason is recorded in the audit trail. */
export function suspendMun(munId: string, reason: string) {
  return request<MunStatusRow>(`/admin/muns/${munId}/suspend`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** SUSPENDED -> VERIFICATION (re-checked before it can go live again). */
export function reinstateMun(munId: string) {
  return request<MunStatusRow>(`/admin/muns/${munId}/reinstate`, { method: "POST" });
}
