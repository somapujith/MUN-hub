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
  // The success body shape isn't load-bearing for either caller (the request
  // step always shows the same confirmation regardless of what comes back,
  // and the confirm step only needs the request to resolve) — parse best
  // effort so an empty 200 body doesn't throw.
  return (await response.json().catch(() => undefined)) as T;
}

/**
 * Starts a "forgot password" reset. Always resolves on a 2xx response
 * whether or not the email matched an account — the backend
 * (`lib/actions/password-reset.ts#requestPasswordReset`) never reveals
 * account existence, so callers must show the same confirmation either way.
 */
export function requestPasswordReset(email: string) {
  return request<void>("/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/**
 * Completes a password reset with a token from the emailed link. Rejects
 * with a user-facing message (e.g. "This reset link is invalid or has
 * expired") for an invalid/expired/used token or a too-short password.
 */
export function confirmPasswordReset(token: string, newPassword: string) {
  return request<void>("/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
}
