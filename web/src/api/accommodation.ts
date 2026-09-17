import type {
  AccommodationOption,
  AccommodationOptionField,
  CreateAccommodationOptionFieldInput,
  CreateAccommodationOptionInput,
  UpdateAccommodationOptionFieldInput,
  UpdateAccommodationOptionInput,
} from "@/types/accommodation";

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
 * PUT /muns/:munId/accommodation/provided — whether the conference offers
 * accommodation at all. NOT_PROVIDED completes the Accommodation module
 * without any options.
 */
export function setAccommodationProvided(munId: string, provided: "PROVIDED" | "NOT_PROVIDED") {
  return request<{ accommodationProvided: "PROVIDED" | "NOT_PROVIDED" }>(`/muns/${munId}/accommodation/provided`, {
    method: "PUT",
    body: JSON.stringify({ provided }),
  });
}

export function listAccommodationOptions(munId: string) {
  return request<AccommodationOption[]>(`/muns/${munId}/accommodation?includeInactive=true`);
}

export function createAccommodationOption(munId: string, input: CreateAccommodationOptionInput) {
  return request<AccommodationOption>(`/muns/${munId}/accommodation`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAccommodationOption(optionId: string, input: UpdateAccommodationOptionInput) {
  return request<AccommodationOption>(`/accommodation/${optionId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAccommodationOption(optionId: string) {
  return request<void>(`/accommodation/${optionId}`, { method: "DELETE" });
}

export function listAccommodationOptionFields(optionId: string) {
  return request<AccommodationOptionField[]>(`/accommodation/${optionId}/fields`);
}

export function createAccommodationOptionField(optionId: string, input: CreateAccommodationOptionFieldInput) {
  return request<AccommodationOptionField>(`/accommodation/${optionId}/fields`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAccommodationOptionField(fieldId: string, input: UpdateAccommodationOptionFieldInput) {
  return request<AccommodationOptionField>(`/accommodation-fields/${fieldId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAccommodationOptionField(fieldId: string) {
  return request<void>(`/accommodation-fields/${fieldId}`, { method: "DELETE" });
}
