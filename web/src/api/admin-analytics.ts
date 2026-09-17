import type { AdminAnalytics } from "@/types/admin-analytics";

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
 * Platform totals for the overview cards (`GET /admin/analytics`,
 * lib/actions/admin-analytics.ts): GMV and platform fees per currency,
 * registrations by status, live MUNs, organizers created in the last 7 days.
 */
export function getAdminAnalytics() {
  return request<AdminAnalytics>("/admin/analytics");
}
