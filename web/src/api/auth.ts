import type { Session } from "@/types";

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

export interface SignInInput {
  email: string;
  password: string;
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

/**
 * Real password sign-in — POST /api/v1/auth/session (`server/routes/auth.ts`).
 * The server sets the `mun_hub_session` cookie on the response; the caller
 * never sees or stores a token directly (`credentials: "include"` above is
 * what makes the browser keep it), it only gets the resulting `{userId,
 * role}` back to seed the client-side session cache with.
 */
export function signIn(input: SignInInput) {
  return request<Session>("/auth/session", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Self-serve signup — POST /api/v1/auth/users. Always creates a STUDENT
 * account (organizer accounts only ever come from the organizer-application
 * flow) and signs the new account in immediately, same cookie behavior as
 * `signIn`.
 */
export function signUp(input: SignUpInput) {
  return request<Session>("/auth/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** DELETE /api/v1/auth/session — invalidates the session and clears the cookie. */
export function signOut() {
  return request<void>("/auth/session", { method: "DELETE" });
}

/**
 * In-app "change password while signed in" — POST /api/v1/auth/session/password
 * (`server/routes/auth.ts`). Requires the current password (re-verified
 * server-side) and, unlike the signed-out reset flow in
 * `password-reset.ts`, does not invalidate the caller's other sessions.
 */
export function changePassword(currentPassword: string, newPassword: string) {
  return request<void>("/auth/session/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
