import type { MunSetupDetails } from "@/types/mun-config";

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

/**
 * Wraps lib/lifecycle/organizer-confirmation.ts#submitFinalConfirmation —
 * PRD Gate 3. Snapshots the submission and advances the mun from
 * CONTENT_SUBMITTED/ORGANIZER_CONFIRMATION to VERIFICATION. Organizer
 * (owning) or admin only.
 */
export function submitFinalConfirmation(munId: string) {
  return request<MunSetupDetails>(`/muns/${munId}/actions/submit-final-confirmation`, {
    method: "POST",
  });
}
