const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json().catch(() => undefined)) as T;
}

/**
 * Completes email verification with a token from the emailed link. Rejects
 * with a user-facing message ("This verification link is invalid or has
 * expired") for an invalid/expired/already-used token.
 */
export function verifyEmail(token: string) {
  return request<void>("/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

/**
 * Requests a fresh verification email. Always resolves on a 2xx response
 * whether or not the email matched an account —
 * `lib/actions/email-verification.ts#resendVerificationEmail` never reveals
 * account existence, so callers must show the same confirmation either way.
 */
export function resendVerificationEmail(email: string) {
  return request<void>("/verify-email/resend", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}
