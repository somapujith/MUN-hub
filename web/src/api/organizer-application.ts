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

/** Mirrors lib/actions/organizer-application.ts's OrganizerApplicationSummary. */
export interface MyOrganizerApplication {
  id: string;
  munId: string | null;
  munName: string | null;
  munSlug: string | null;
  munStatus: string | null;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
  /** The Gate-1 reviewer's note to the organizer, if any. */
  reviewNotes: string | null;
  submittedAt: string;
  // The organizer's own editable answers — used to pre-fill the resubmit
  // form when status is CHANGES_REQUESTED.
  munDescription: string | null;
  munCity: string | null;
  munStartDate: string | null;
  expectedDelegateCount: number | null;
  previousEditions: string | null;
  websiteUrl: string | null;
  /** Which fields the reviewer flagged on the current CHANGES_REQUESTED round, if any. */
  fieldsRequiringCorrection: string[];
  /** How many times this application has been resubmitted after CHANGES_REQUESTED. */
  resubmissionCount: number;
}

/**
 * POST /organizer/applications — applies to host one more MUN. ORGANIZER
 * accounts with finished onboarding only; refused (409) while an earlier
 * application still awaits review.
 */
export function submitOrganizerApplication(input: SubmitOrganizerApplicationInput) {
  return request<OrganizerApplication>("/organizer/applications", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** GET /organizer/applications: the signed-in organizer's applications, newest first. */
export function listMyOrganizerApplications() {
  return request<MyOrganizerApplication[]>("/organizer/applications");
}

/**
 * POST /organizer/applications/:munId/resubmit — the Gate-1 loop: puts an
 * existing CHANGES_REQUESTED application back to SUBMITTED. Refused (403) if
 * the mun isn't the caller's own, or (409) if it isn't currently
 * CHANGES_REQUESTED.
 */
export function resubmitOrganizerApplication(munId: string, input: SubmitOrganizerApplicationInput) {
  return request<OrganizerApplication>(`/organizer/applications/${munId}/resubmit`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
