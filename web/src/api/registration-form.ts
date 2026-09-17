import type {
  FormField,
  FormFieldInput,
  UpdateFormFieldInput,
} from "@/types/registration-form";

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

/** Public read (no auth) — also lazily seeds the mun's default fields server-side. */
export function listFormFields(munId: string) {
  return request<FormField[]>(`/muns/${munId}/form-fields`);
}

export function createFormField(munId: string, input: FormFieldInput) {
  return request<FormField>(`/muns/${munId}/form-fields`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateFormField(fieldId: string, input: UpdateFormFieldInput) {
  return request<FormField>(`/form-fields/${fieldId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteFormField(fieldId: string) {
  return request<void>(`/form-fields/${fieldId}`, { method: "DELETE" });
}

export function reorderFormFields(munId: string, order: Array<{ id: string; displayOrder: number }>) {
  return request<FormField[]>(`/muns/${munId}/form-fields/actions/reorder`, {
    method: "POST",
    body: JSON.stringify({ order }),
  });
}
