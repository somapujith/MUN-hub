import type { MunContact, UpsertMunContactInput } from "@/types/mun-contact";

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

/** Wraps lib/actions/mun-contact.ts#getMunContact — public read, no auth. Null if never set. */
export function getMunContact(munId: string) {
  return request<MunContact | null>(`/muns/${munId}/contact`);
}

/** Wraps lib/actions/mun-contact.ts#upsertMunContact — owning organizer or admin only. */
export function upsertMunContact(munId: string, input: UpsertMunContactInput) {
  return request<MunContact>(`/muns/${munId}/contact`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
