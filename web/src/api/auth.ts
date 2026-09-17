import type { Session } from "@/types";

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
 * GET /api/v1/auth/session — who the session cookie belongs to, or `null` when
 * signed out. The cookie travels via `credentials: "include"`; there is no
 * client-side token to read, so this endpoint is the only way the SPA learns
 * its own identity.
 */
export function getSession() {
  return request<Session | null>("/auth/session");
}

export interface SignInInput {
  email: string;
  password: string;
}

/**
 * Mirrors server/routes/auth.ts's signUpBodySchema. Required fields match
 * lib/actions/student-profile.ts's completeStudentProfile requirements plus
 * gender + consent (docs/prd/MUNHub_User_Workflow_PRD.md §9-16); everything
 * else is optional, same set a student can fill in later on their profile.
 */
export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  gender: string;
  phone: string;
  institution: string;
  dateOfBirth: string;
  gradeOrYear: string;
  residentialAddress: string;
  requiresTransportation?: boolean;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  acceptedTermsOfService: boolean;
  acceptedPrivacyPolicy: boolean;
  /** Required (true) by the server when dateOfBirth makes the user under 18. */
  acceptedGuardianAcknowledgement?: boolean;
  /** Cloudflare Turnstile token, when the bot check is enabled (hooks/use-turnstile.tsx). */
  turnstileToken?: string;
  munExperience?: string;
  referralCode?: string;
  preferredName?: string;
  nationality?: string;
  addressCity?: string;
  addressState?: string;
  addressCountry?: string;
  postalCode?: string;
  alternateMobile?: string;
  courseOrProgram?: string;
  graduationYear?: number;
  department?: string;
  studentId?: string;
  academicEmail?: string;
  alternateEmergencyContactName?: string;
  alternateEmergencyContactNumber?: string;
  alternateEmergencyContactRelation?: string;
  hasPriorMunExperience?: boolean;
  munsAttendedCount?: number;
  previousAchievements?: string;
  bio?: string;
  areasOfInterest?: string[];
  languages?: string[];
  isPublicProfileVisible?: boolean;
}

/**
 * `signIn`'s result: a real session (cookie set), or — only for a staff
 * account with confirmed TOTP enrollment (lib/actions/staff-mfa.ts) —
 * `MFA_REQUIRED`, meaning the password was correct but no cookie was set yet.
 * `pendingToken` must be completed via `completeMfaChallenge`.
 */
export type SignInResult =
  | ({ status: "SIGNED_IN" } & Session)
  | { status: "MFA_REQUIRED"; pendingToken: string };

/**
 * Real password sign-in — POST /api/v1/auth/session (`server/routes/auth.ts`).
 * On `SIGNED_IN`, the server sets the `mun_hub_session` cookie on the
 * response; the caller never sees or stores a token directly
 * (`credentials: "include"` above is what makes the browser keep it). On
 * `MFA_REQUIRED`, no cookie is set — the caller must complete the challenge.
 */
export function signIn(input: SignInInput) {
  return request<SignInResult>("/auth/session", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Step 2 of staff sign-in when `signIn` returned `MFA_REQUIRED` — POST
 * /api/v1/auth/session/mfa. `code` is either a 6-digit TOTP or an
 * `XXXXX-XXXXX` recovery code. Sets the session cookie on success, same as
 * `signIn`'s `SIGNED_IN` branch.
 */
export function completeMfaChallenge(input: { pendingToken: string; code: string }) {
  return request<{ status: "SIGNED_IN" } & Session>("/auth/session/mfa", {
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
 * server-side). Signs the account out on every other device; this session
 * stays signed in.
 */
export function changePassword(currentPassword: string, newPassword: string) {
  return request<void>("/auth/session/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
