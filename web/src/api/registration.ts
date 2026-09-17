import type { MockRegistrationDetail, PaymentStatus, RegistrationStatus } from "@/types";

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

/** Provider key of the dev/test mock checkout (lib/payments/mock-adapter.ts). */
export const MOCK_PAYMENT_PROVIDER = "mock_razorpay";

export interface InitiateRegistrationInput {
  munId: string;
  registrationProductId: string;
  committeeId?: string;
  portfolioId?: string;
  formResponses?: Record<string, unknown>;
  accommodationOptionId?: string;
  accommodationAnswers?: Record<string, unknown>;
}

export interface InitiateRegistrationResult {
  registrationId: string;
  /** Null for a free pass — it is CONFIRMED straight away, nothing to pay. */
  orderId: string | null;
  status: RegistrationStatus;
  /** True when the server returned the registration an earlier submit (same key) created. */
  replayed: boolean;
}

/**
 * Wraps `POST /registrations` (lib/actions/registration.ts#initiateRegistration).
 * Session-derived actor — never send a `userId`. Requires an
 * `Idempotency-Key` (spec Section 6.4) so a duplicate submit (double click,
 * retried network request) returns the same registration instead of
 * reserving a second seat. Fails with the server's friendly message when
 * online payments are unavailable (503 PAYMENTS_UNAVAILABLE).
 */
export function initiateRegistration(
  input: InitiateRegistrationInput,
  idempotencyKey: string,
): Promise<InitiateRegistrationResult> {
  return request<InitiateRegistrationResult>("/registrations", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

/**
 * Wire shape of `GET /registrations/:id` (server/routes/registrations.ts).
 * Dates come back as ISO strings (JSON has no Date type) — converted below,
 * same convention as `api/student-dashboard.ts#RawRegistration`.
 */
interface RawRegistrationDetail {
  id: string;
  status: RegistrationStatus;
  registrationProductId: string;
  committeeId: string | null;
  portfolioId: string | null;
  userId: string;
  expiresAt: string | null;
  registrationGroupId: string | null;
  /** True only for the head delegate's own row in a group registration. */
  isGroupHead: boolean;
  productName: string;
  productPrice: number;
  mun: {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    country: string | null;
    startDate: string | null;
    endDate: string | null;
  };
  committee: { name: string } | null;
  portfolio: { name: string } | null;
  payment: Array<{ amount: number; currency: string; status: PaymentStatus }>;
  paymentProvider: string | null;
}

function toRegistrationDetail(raw: RawRegistrationDetail): MockRegistrationDetail {
  return {
    id: raw.id,
    status: raw.status,
    registrationProductId: raw.registrationProductId,
    committeeId: raw.committeeId,
    portfolioId: raw.portfolioId,
    userId: raw.userId,
    expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : null,
    registrationGroupId: raw.registrationGroupId,
    isGroupHead: raw.isGroupHead,
    productName: raw.productName,
    productPrice: raw.productPrice,
    mun: {
      id: raw.mun.id,
      slug: raw.mun.slug,
      name: raw.mun.name,
      city: raw.mun.city,
      country: raw.mun.country,
      startDate: raw.mun.startDate ? new Date(raw.mun.startDate) : null,
      endDate: raw.mun.endDate ? new Date(raw.mun.endDate) : null,
    },
    committee: raw.committee ? { name: raw.committee.name } : null,
    portfolio: raw.portfolio ? { name: raw.portfolio.name } : null,
    payment: raw.payment.map((p) => ({ amount: p.amount, currency: p.currency, status: p.status })),
    paymentProvider: raw.paymentProvider,
  };
}

/**
 * Wraps `GET /registrations/:id`. Throws (via `request`) on a 404 or a 403
 * — the caller isn't the owner/admin/organizer for this registration.
 */
export async function fetchRegistrationById(id: string): Promise<MockRegistrationDetail> {
  const raw = await request<RawRegistrationDetail>(`/registrations/${id}`);
  return toRegistrationDetail(raw);
}

/** Response of the payment webhook processor, relayed by the mock checkout. */
export interface MockPaymentResult {
  ok: boolean;
  /** The registration is now confirmed. */
  confirmed?: boolean;
  /** This payment had already been applied. */
  duplicate?: boolean;
  /** Authentic, but nothing changed (e.g. a failure after a capture). */
  ignored?: boolean;
  /** Money was taken without a valid registration; support resolves it. */
  exception?: boolean;
}

/**
 * Wraps `POST /registrations/:id/mock-payment` — the dev/test mock checkout,
 * only present when the server runs with the mock payments adapter. The
 * server signs a provider-shaped webhook and runs it through the same
 * verification + settlement path as a real delivery, so confirmation never
 * happens client-side.
 */
export function completeMockPayment(
  registrationId: string,
  outcome: "success" | "failure",
): Promise<MockPaymentResult> {
  return request<MockPaymentResult>(`/registrations/${registrationId}/mock-payment`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
}

export interface RegistrationReceipt {
  registrationId: string;
  status: RegistrationStatus;
  registeredAt: Date;
  mun: {
    name: string;
    slug: string;
    city: string | null;
    country: string | null;
    startDate: Date | null;
    endDate: Date | null;
  };
  passName: string;
  committeeName: string | null;
  portfolioName: string | null;
  /** Null for a free pass. */
  payment: {
    amount: number;
    currency: string;
    status: PaymentStatus;
    reference: string | null;
    orderId: string;
    paidAt: Date | null;
  } | null;
}

type RawReceipt = Omit<RegistrationReceipt, "registeredAt" | "mun" | "payment"> & {
  registeredAt: string;
  mun: Omit<RegistrationReceipt["mun"], "startDate" | "endDate"> & {
    startDate: string | null;
    endDate: string | null;
  };
  payment: (Omit<NonNullable<RegistrationReceipt["payment"]>, "paidAt"> & { paidAt: string | null }) | null;
};

const toDate = (value: string | null) => (value ? new Date(value) : null);

/** Wraps `GET /registrations/:id/receipt` — owner-only; anyone else gets a 404. */
export async function fetchRegistrationReceipt(id: string): Promise<RegistrationReceipt> {
  const raw = await request<RawReceipt>(`/registrations/${encodeURIComponent(id)}/receipt`);
  return {
    ...raw,
    registeredAt: new Date(raw.registeredAt),
    mun: { ...raw.mun, startDate: toDate(raw.mun.startDate), endDate: toDate(raw.mun.endDate) },
    payment: raw.payment ? { ...raw.payment, paidAt: toDate(raw.payment.paidAt) } : null,
  };
}
