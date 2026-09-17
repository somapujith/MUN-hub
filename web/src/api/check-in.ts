import type { CheckInResult, RegistrationPass } from "@/types/check-in";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

/** Carries the API's HTTP status so callers can tell "not found" from "not yet". */
export class CheckInApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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
    throw new CheckInApiError(body?.error?.message ?? `Request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

export const checkInKeys = {
  pass: (registrationId: string) => ["registration", "pass", registrationId] as const,
};

/** The signed-in delegate's own pass. Wraps lib/actions/check-in.ts#getRegistrationPass. */
export function getRegistrationPass(registrationId: string) {
  return request<RegistrationPass>(`/me/registrations/${encodeURIComponent(registrationId)}/pass`);
}

/** Door check-in by pass code — owning organizer or platform staff. */
export function checkInDelegate(munId: string, code: string) {
  return request<CheckInResult>(`/organizer/muns/${munId}/check-in`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}
