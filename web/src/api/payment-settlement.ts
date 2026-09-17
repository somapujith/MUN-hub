import type { MaskedPaymentSettings, UpsertPaymentSettingsInput } from "@/types/payment-settlement";

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

/** Returns the masked settlement configuration, or `null` if none has been submitted yet. */
export function getPaymentSettings(munId: string) {
  return request<MaskedPaymentSettings | null>(`/muns/${munId}/payment-settings`);
}

/**
 * Creates or replaces the settlement configuration. `input.pan`/`input.accountNumber`
 * are full plaintext values — see lib/actions/payment-settlement.ts. Never
 * stash these anywhere client-side beyond the in-progress form state.
 */
export function upsertPaymentSettings(munId: string, input: UpsertPaymentSettingsInput) {
  return request<MaskedPaymentSettings>(`/muns/${munId}/payment-settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
