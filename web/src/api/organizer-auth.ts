import type { Session } from "@/types";

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
  return response.json() as Promise<T>;
}

export interface OrganizerSignUpInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  acceptedTermsOfService: boolean;
  acceptedPrivacyPolicy: boolean;
}

/**
 * POST /api/v1/auth/organizers — creates an ORGANIZER account and signs it in
 * (session cookie set by the server). Organizer and delegate accounts are
 * separate: this never creates or touches a student profile, and a delegate
 * account can't be turned into an organizer one.
 */
export function signUpOrganizer(input: OrganizerSignUpInput) {
  return request<Session>("/auth/organizers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
