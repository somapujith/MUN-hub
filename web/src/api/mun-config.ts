import type { MunSetupDetails, UpdateMunDetailsInput } from "@/types/mun-config";

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

/**
 * Wraps lib/actions/mun-config.ts#getMunDetails — owning organizer or admin
 * only. Not filtered by publication status, unlike the public mun-detail
 * read, so it works for a mun still in any pre-publication lifecycle state.
 */
export function getMunDetails(munId: string) {
  return request<MunSetupDetails>(`/organizer/muns/${munId}/details`);
}

/** Wraps lib/actions/mun-config.ts#updateMunDetails. */
export function updateMunDetails(munId: string, input: UpdateMunDetailsInput) {
  return request<MunSetupDetails>(`/muns/${munId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
