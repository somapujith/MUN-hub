import type { StudentProfile, StudentProfileInput } from "@/types/student-profile";

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

/** GET /profile — null if the signed-in student hasn't completed onboarding yet. */
export function getStudentProfile() {
  return request<StudentProfile | null>("/profile");
}

/** GET /profile/complete — cheap boolean check used to gate the registration funnel. */
export function getProfileCompletion() {
  return request<{ complete: boolean }>("/profile/complete");
}

/**
 * GET /profile/form-defaults — the saved profile keyed by the per-mun
 * registration form's own `fieldKey`s, for pre-filling matching questions.
 * `{}` when the student has no profile yet.
 */
export function getProfileFormDefaults() {
  return request<Record<string, string>>("/profile/form-defaults");
}

/** PUT /profile — create-or-update, same action serves first-time onboarding and later edits. */
export function completeStudentProfile(input: StudentProfileInput) {
  return request<StudentProfile>("/profile", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
