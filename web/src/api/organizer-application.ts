export interface SubmitOrganizerApplicationInput {
  conferenceName: string;
  expectedDate: string;
  location: string;
  expectedDelegateCount: number;
  description: string;
  previousEditions?: string;
  websiteUrl?: string;
}

export interface OrganizerApplication {
  id: string;
  organizerId: string;
  munId: string | null;
  status: string;
  reviewNotes: string | null;
  submittedAt: string;
}

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
  return response.json() as Promise<T>;
}

/** Wraps lib/actions/organizer-application.ts#submitOrganizerApplication. Any signed-in user may call this — it's how a STUDENT becomes an ORGANIZER's applicant. */
export function submitOrganizerApplication(input: SubmitOrganizerApplicationInput) {
  return request<OrganizerApplication>("/organizer/applications", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
