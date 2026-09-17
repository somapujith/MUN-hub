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

export const ONBOARDING_STEPS = ["PROFILE", "MUN", "DETAILS", "PAYMENT", "AGREEMENT"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const MIN_DESCRIPTION_LENGTH = 40;
export const MAX_EXPECTED_DELEGATES = 10_000;

/** Mirrors lib/actions/organizer-onboarding.ts's OrganizerOnboarding. */
export interface OrganizerOnboarding {
  profile: {
    firstName: string | null;
    lastName: string | null;
    contactPhone: string | null;
    /** School, college or society hosting the MUN; delegates see it as the host. */
    organization: string | null;
    munName: string | null;
    munCity: string | null;
    /** YYYY-MM-DD */
    munStartDate: string | null;
    expectedDelegateCount: number | null;
    munDescription: string | null;
    previousEditions: string | null;
    websiteUrl: string | null;
    upiId: string | null;
    upiPhone: string | null;
  };
  completedSteps: OnboardingStep[];
  nextStep: OnboardingStep | null;
  completed: boolean;
  /** The MUN created from the wizard's answers once the agreement is accepted. */
  firstMunId: string | null;
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

export const MAX_ORGANIZATION_LENGTH = 120;

/** The host name delegates see. Editable after onboarding; "" clears it. */
export function updateOrganization(organization: string) {
  return request<{ organization: string | null }>("/organizer/organization", {
    method: "PUT",
    body: JSON.stringify({ organization }),
  });
}

export const saveProfileStep = (input: {
  firstName: string;
  lastName: string;
  contactPhone: string;
  organization: string;
}) => put("profile", input);

export const saveMunStep = (input: { munName: string; munCity: string; munStartDate: string }) => put("mun", input);

export const saveDetailsStep = (input: {
  expectedDelegateCount: number;
  munDescription: string;
  previousEditions?: string;
  websiteUrl?: string;
}) => put("details", input);

export const savePaymentStep = (input: { upiId: string; upiPhone: string }) => put("payment", input);

/** Accepts the organizer agreement, which also submits the MUN answers as the organizer's application. */
export function acceptAgreement() {
  return request<OrganizerOnboarding>("/organizer/onboarding/agreement", {
    method: "POST",
    body: JSON.stringify({ accepted: true }),
  });
}
