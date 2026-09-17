import type { ListOrganizersParams, ListOrganizersResult } from "@/types/organizer-admin";

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
