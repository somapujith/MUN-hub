import type { Role } from "@/types/enums";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    // Merged headers go last so a caller's own headers can't wipe Content-Type.
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface OrganizerProfileInput {
  name: string;
  phone?: string;
  acceptedTermsOfService: boolean;
  acceptedPrivacyPolicy: boolean;
}

export type OrganizerCodeVerification =
  | { status: "PROFILE_REQUIRED" }
  | { status: "SIGNED_IN"; userId: string; role: Role; isNewAccount: boolean };

/**
 * POST /api/v1/auth/organizers/code — emails a 6-digit sign-in code. Succeeds
 * the same way for any address, registered or not. `turnstileToken` is
 * required by the server only when its Turnstile bot check is enabled.
 */
export function requestOrganizerCode(email: string, turnstileToken?: string) {
  return request<void>("/auth/organizers/code", {
    method: "POST",
    body: JSON.stringify({ email, turnstileToken }),
  });
}

/**
 * POST /api/v1/auth/organizers/session — checks the code. An existing
 * organizer is signed in (session cookie set by the server). A new address
 * gets `PROFILE_REQUIRED` and calls again with the same code plus `profile`,
 * which creates the organizer account. There are no organizer passwords.
 */
export function verifyOrganizerCode(input: { email: string; code: string; profile?: OrganizerProfileInput }) {
  return request<OrganizerCodeVerification>("/auth/organizers/session", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
