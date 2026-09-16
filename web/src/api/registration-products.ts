import type {
  RegistrationProduct,
  RegistrationProductInput,
  UpdateRegistrationProductInput,
} from "@/types/registration-product";

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
 * `includeInactive=true` so the organizer view sees deactivated products too
 * (the server only honors this when the caller owns the mun or is
 * admin/ops — see `resolveIncludeInactive` in server/routes/mun-config.ts).
 */
export function listRegistrationProducts(munId: string) {
  return request<RegistrationProduct[]>(`/muns/${munId}/products?includeInactive=true`);
}

export function createRegistrationProduct(munId: string, input: RegistrationProductInput) {
  return request<RegistrationProduct>(`/muns/${munId}/products`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateRegistrationProduct(productId: string, input: UpdateRegistrationProductInput) {
  return request<RegistrationProduct>(`/products/${productId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** Soft-delete (sets status to "inactive" server-side) — see lib/actions/mun-config.ts's deleteRegistrationProduct. */
export function deactivateRegistrationProduct(productId: string) {
  return request<void>(`/products/${productId}`, { method: "DELETE" });
}
