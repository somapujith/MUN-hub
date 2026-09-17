import type { ListPaymentExceptionsParams, ListPaymentExceptionsResult, ResolvedPaymentException } from "@/types/admin-payments";

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
 * Payment exceptions (money taken with no valid registration behind it),
 * newest first, paginated — `GET /admin/payment-exceptions`
 * (server/routes/admin-search.ts → lib/payments/exceptions.ts).
 */
export function listPaymentExceptions(params: ListPaymentExceptionsParams = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.q) query.set("q", params.q);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return request<ListPaymentExceptionsResult>(`/admin/payment-exceptions${qs ? `?${qs}` : ""}`);
}

/** Marks one exception resolved. The note is required and goes into the audit log. */
export function resolvePaymentException(paymentId: string, note: string) {
  return request<ResolvedPaymentException>(
    `/admin/payment-exceptions/${encodeURIComponent(paymentId)}/resolve`,
    { method: "POST", body: JSON.stringify({ note }) },
  );
}
