import type { AccountSettings, DeleteAccountInput } from "@/types/account";

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

export function getAccountSettings() {
  return request<AccountSettings>("/account");
}

export function setEmailNotificationsEnabled(enabled: boolean) {
  return request<void>("/account/notifications", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

/**
 * "Download my data" — GET /account/export (lib/actions/data-export.ts).
 * Returns the export as a pretty-printed JSON file ready to save. The file
 * name is built here: the API's Content-Disposition header isn't readable
 * cross-origin (api.munhub.in → app.munhub.in) without an expose-headers rule.
 */
export async function downloadAccountData(): Promise<{ blob: Blob; filename: string }> {
  const data = await request<unknown>("/account/export");
  const date = new Date().toISOString().slice(0, 10);
  return {
    blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    filename: `munhub-data-${date}.json`,
  };
}

/**
 * Permanently deletes (anonymizes) the signed-in delegate's account —
 * POST /account/delete (lib/actions/account-deletion.ts). The server signs
 * every session out and clears the session cookie; organizer and staff
 * accounts get a 403 telling them to contact support.
 */
export function deleteAccount(input: DeleteAccountInput) {
  return request<void>("/account/delete", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
