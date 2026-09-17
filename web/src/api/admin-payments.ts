import type { PaymentExceptionRow, ResolvedPaymentException } from "@/types/admin-payments";

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
 * Open payment exceptions (money taken with no valid registration behind
 * it), newest first — `GET /admin/payment-exceptions`
 * (server/routes/admin-search.ts → lib/payments/exceptions.ts).
 */
export function listPaymentExceptions() {
  return request<PaymentExceptionRow[]>("/admin/payment-exceptions");
}

/** Marks one exception resolved. The note is required and goes into the audit log. */
export function resolvePaymentException(paymentId: string, note: string) {
  return request<ResolvedPaymentException>(
    `/admin/payment-exceptions/${encodeURIComponent(paymentId)}/resolve`,
    { method: "POST", body: JSON.stringify({ note }) },
  );
}
