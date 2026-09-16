import type { PaymentExceptionRow } from "@/types/admin-payments";

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
 * Payment exception queue for the admin console. Reuses the existing
 * `/admin/payment-exceptions` route (server/routes/admin-search.ts, backed
 * by `lib/actions/admin-search.ts#listPaymentExceptions`) — no new backend
 * endpoint needed for this page.
 */
export function listPaymentExceptions() {
  return request<PaymentExceptionRow[]>("/admin/payment-exceptions");
}
