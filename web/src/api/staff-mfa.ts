import type { MfaConfirmResult, MfaEnrollmentStatus, MfaSetupResult } from "@/types/staff-mfa";

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
  return response.json() as Promise<T>;
}

/** GET /auth/mfa/status — requireAuth only, so this works before enrollment too. */
export function getMfaStatus() {
  return request<MfaEnrollmentStatus>("/auth/mfa/status");
}

/**
 * POST /auth/mfa/setup — starts (or restarts) enrollment and returns a fresh
 * secret. Calling this again before confirming replaces the pending secret;
 * the previously shown QR/key simply stops working.
 */
export function beginMfaSetup() {
  return request<MfaSetupResult>("/auth/mfa/setup", { method: "POST", cache: "no-store" });
}

/**
 * POST /auth/mfa/confirm — proves the account can generate a valid code,
 * confirms enrollment, and returns 10 recovery codes in plaintext exactly
 * once.
 */
export function confirmMfaSetup(code: string) {
  return request<MfaConfirmResult>("/auth/mfa/confirm", {
    method: "POST",
    body: JSON.stringify({ code }),
    cache: "no-store",
  });
}

/**
 * POST /auth/mfa/recovery-codes — mints a fresh set of 10 recovery codes,
 * replacing the old ones. Requires a *current TOTP code* (not a recovery
 * code — regenerating is about to invalidate all of them anyway).
 */
export function regenerateMfaRecoveryCodes(code: string) {
  return request<MfaConfirmResult>("/auth/mfa/recovery-codes", {
    method: "POST",
    body: JSON.stringify({ code }),
    cache: "no-store",
  });
}

/**
 * POST /auth/mfa/disable — turns 2FA off for the caller's own account. Takes
 * a TOTP or recovery code to prove it's really the account holder.
 */
export function disableMfa(code: string) {
  return request<void>("/auth/mfa/disable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}
