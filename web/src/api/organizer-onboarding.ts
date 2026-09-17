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

export const ONBOARDING_STEPS = ["PROFILE", "PAN", "GST", "PAYMENT", "AGREEMENT"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Mirrors lib/actions/organizer-onboarding.ts's OrganizerOnboarding. The PAN only ever comes back as its last 4. */
export interface OrganizerOnboarding {
  profile: {
    firstName: string | null;
    lastName: string | null;
    contactPhone: string | null;
    panName: string | null;
    panLast4: string | null;
    hasGstin: boolean | null;
    gstin: string | null;
    upiId: string | null;
    upiPhone: string | null;
  };
  completedSteps: OnboardingStep[];
  nextStep: OnboardingStep | null;
  completed: boolean;
  agreementVersion: string;
}

export function getOrganizerOnboarding() {
  return request<OrganizerOnboarding>("/organizer/onboarding");
}

function put<T>(path: string, body: T) {
  return request<OrganizerOnboarding>(`/organizer/onboarding/${path}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export const saveProfileStep = (input: { firstName: string; lastName: string; contactPhone: string }) =>
  put("profile", input);

export const savePanStep = (input: { panNumber: string; panName: string }) => put("pan", input);

export const saveGstStep = (input: { hasGstin: boolean; gstin?: string }) => put("gst", input);

export const savePaymentStep = (input: { upiId: string; upiPhone: string }) => put("payment", input);

export function acceptAgreement() {
  return request<OrganizerOnboarding>("/organizer/onboarding/agreement", {
    method: "POST",
    body: JSON.stringify({ accepted: true }),
  });
}
