"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/app/lib/session";
import { getMunBySlug } from "@/lib/actions/marketplace";
import {
  getProductAvailability,
  getRegistrationById,
  initiateRegistration,
} from "@/lib/actions/registration";
import {
  listAccommodationOptionFields,
  listAccommodationOptions,
  type AccommodationOptionField,
} from "@/lib/actions/accommodation";
import {
  isSelectableOption,
  parseFieldValues,
  toAnswers,
  validateFieldValues,
} from "@/components/registration/accommodation-fields";
import { simulatePaymentOutcome } from "@/lib/payments/mock-adapter";
import { listFormFields } from "@/lib/actions/registration-form";

/**
 * Result shape for the registration form's `useActionState`.
 *
 * On success we never return here — `initiateRegistration` is followed by a
 * `redirect()` into the mock checkout, because a registration is only ever
 * CONFIRMED by the payments webhook (see `app/api/webhooks/payments/route.ts`).
 * The client must not treat "action returned" as "registered".
 */
export interface RegisterFormState {
  status: "idle" | "error";
  /** Human-readable message rendered in the form's error region. */
  message?: string;
  /**
   * Machine-readable reason so the UI can pick the right recovery affordance
   * (e.g. "sold out" points back to the MUN page, "validation" keeps the form).
   */
  reason?:
    | "validation"
    | "capacity"
    | "forbidden"
    | "closed"
    | "accommodation"
    | "unknown";
}

/** Maps a thrown backend error onto a form state the UI can branch on. */
function toFormState(error: unknown): RegisterFormState {
  const message = error instanceof Error ? error.message : "";

  if (message === "Registration product is at capacity") {
    return {
      status: "error",
      reason: "capacity",
      message:
        "That option sold out while you were filling in the form. No seat was reserved and you have not been charged.",
    };
  }

  if (message === "Forbidden") {
    return {
      status: "error",
      reason: "forbidden",
      message: "Your session expired. Sign in again to continue.",
    };
  }

  if (message === "Registration product not found") {
    return {
      status: "error",
      reason: "validation",
      message: "That registration option is no longer available.",
    };
  }

  // Accommodation failures must land the user on the accommodation step, not
  // the option picker — the seat they chose is fine, the room isn't.
  if (message === "Accommodation option is at capacity") {
    return {
      status: "error",
      reason: "accommodation",
      message:
        "That accommodation sold out while you were filling in the form. No seat or room was reserved and you have not been charged — pick another option or continue without accommodation.",
    };
  }

  if (
    message === "Accommodation option not found" ||
    message === "Accommodation option is not available" ||
    message === "Accommodation option does not belong to this mun"
  ) {
    return {
      status: "error",
      reason: "accommodation",
      message:
        "That accommodation option is no longer available. Pick another one or continue without accommodation.",
    };
  }

  return {
    status: "error",
    reason: "unknown",
    message: "Something went wrong starting your registration. Please try again.",
  };
}

/**
 * Reserves a seat and opens a payment order, then hands off to the mock
 * checkout.
 *
 * Everything security-relevant is re-derived server-side: the acting user
 * comes from `getSession()` (never the form), the MUN comes from the slug in
 * the URL, and the chosen product must belong to that MUN. A client that POSTs
 * a `registrationProductId` from a different MUN gets rejected here rather than
 * silently registering against another conference's inventory.
 */
export async function submitRegistrationAction(
  _prevState: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  const slug = String(formData.get("slug") ?? "");
  const registrationProductId = String(formData.get("registrationProductId") ?? "");
  const committeeId = String(formData.get("committeeId") ?? "");
  const portfolioId = String(formData.get("portfolioId") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const institution = String(formData.get("institution") ?? "").trim();
  const experience = String(formData.get("experience") ?? "").trim();
  const dietary = String(formData.get("dietary") ?? "").trim();
  const accommodations = String(formData.get("accommodations") ?? "").trim();
  let customFieldValues: Record<string, unknown> = {};
  try {
    const rawCustomFields = String(formData.get("customFieldValues") ?? "{}");
    const parsed = JSON.parse(rawCustomFields);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) customFieldValues = parsed;
  } catch {
    return { status: "error", reason: "validation", message: "Check the form fields and try again." };
  }
  // `""` means "No accommodation" — the skip path.
  const accommodationOptionId = String(formData.get("accommodationOptionId") ?? "").trim();
  const accommodationFieldValuesRaw = String(
    formData.get("accommodationFieldValues") ?? "",
  );

  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/register/${slug}`)}`);
  }

  if (!registrationProductId) {
    return {
      status: "error",
      reason: "validation",
      message: "Choose a registration option to continue.",
    };
  }

  if (!fullName || !email || !institution) {
    return {
      status: "error",
      reason: "validation",
      message: "Full name, email, and institution are required.",
    };
  }

  const mun = await getMunBySlug(slug);
  if (!mun) {
    return {
      status: "error",
      reason: "validation",
      message: "This conference is no longer available.",
    };
  }

  if (mun.status !== "REGISTRATION_OPEN") {
    return {
      status: "error",
      reason: "closed",
      message: "Registration for this conference has closed.",
    };
  }

  // The product must belong to THIS mun — never trust the id alone.
  const product = mun.registrationProducts.find((p) => p.id === registrationProductId);
  if (!product) {
    return {
      status: "error",
      reason: "validation",
      message: "That registration option is no longer available.",
    };
  }

  const formFields = await listFormFields(mun.id);
  for (const field of formFields) {
    if (field.required && !String(customFieldValues[field.fieldKey] ?? "").trim()) {
      return { status: "error", reason: "validation", message: `${field.label} is required.` };
    }
  }

  // Same for committee/portfolio: both are optional, but if supplied they must
  // belong to this mun's committee tree.
  const committee = committeeId
    ? mun.committees.find((c) => c.id === committeeId)
    : undefined;
  if (committeeId && !committee) {
    return {
      status: "error",
      reason: "validation",
      message: "That committee is not part of this conference.",
    };
  }

  const portfolio =
    portfolioId && committee
      ? committee.portfolios.find((p) => p.id === portfolioId)
      : undefined;
  if (portfolioId && !portfolio) {
    return {
      status: "error",
      reason: "validation",
      message: "That portfolio is not part of the selected committee.",
    };
  }

  // ---- Accommodation (optional) ------------------------------------------
  // Re-validated here against freshly-read definitions rather than trusting
  // the client. `initiateRegistration` also re-checks ownership, status and
  // capacity transactionally, but it treats `accommodationAnswers` as an
  // opaque jsonb blob and does NOT validate it — so required/choice checking
  // has to happen here or it happens nowhere.
  let accommodationAnswers: Record<string, unknown> | undefined;

  if (accommodationOptionId) {
    // Scoped to THIS mun, so a foreign option id can't be attached.
    const options = await listAccommodationOptions(mun.id);
    const option = options
      .filter(isSelectableOption)
      .find((entry) => entry.id === accommodationOptionId);

    if (!option) {
      return {
        status: "error",
        reason: "accommodation",
        message:
          "That accommodation option is no longer available. Pick another one or continue without accommodation.",
      };
    }

    const fields: AccommodationOptionField[] = await listAccommodationOptionFields(
      option.id,
    );
    const values = parseFieldValues(accommodationFieldValuesRaw);
    const fieldErrors = validateFieldValues(fields, values);

    if (fieldErrors.length > 0) {
      return {
        status: "error",
        reason: "accommodation",
        message: fieldErrors.map((error) => error.message).join(" "),
      };
    }

    // Built from the field definitions, not from the raw POST — an extra key
    // a crafted request smuggled in has no matching field and is dropped.
    accommodationAnswers = toAnswers(fields, values);
  }

  let registrationId: string;
  try {
    // NOTE: no `userId` is passed — actor comes from `session` resolved
    // above. Passing a client userId would be an IDOR (see the action's
    // doc comment).
    const result = await initiateRegistration(
      {
        munId: mun.id,
        registrationProductId: product.id,
        committeeId: committee?.id,
        portfolioId: portfolio?.id,
        formResponses: {
          fullName,
          email,
          phone: phone || null,
          institution,
          experience: experience || null,
          dietary: dietary || null,
          accommodations: accommodations || null,
          ...customFieldValues,
        },
        // Skip path: both stay `undefined`, so the column stays NULL and
        // `initiateRegistration` never enters its accommodation branch at all.
        accommodationOptionId: accommodationOptionId || undefined,
        accommodationAnswers,
      },
      session,
    );
    registrationId = result.registrationId;
  } catch (error) {
    return toFormState(error);
  }

  // A seat is now held for 15 minutes as PAYMENT_PENDING. Only the webhook can
  // promote it to CONFIRMED, so send the user through checkout.
  redirect(`/register/${slug}/pay?registrationId=${encodeURIComponent(registrationId)}`);
}

/**
 * Loads the custom field definitions for one accommodation option.
 *
 * Called on selection rather than prefetched for every option at page load: a
 * conference can publish many room types each with many questions, and the
 * student will only ever fill in one set. Same over-fetch discipline the rest
 * of this funnel follows.
 *
 * The option is re-resolved through `listAccommodationOptions(munId)` so this
 * can't be used to enumerate another conference's field definitions by id.
 * Public read, matching `listAccommodationOptionFields` itself — no session
 * required, because the accommodation page is public.
 */
export async function loadAccommodationFieldsAction(
  slug: string,
  optionId: string,
): Promise<AccommodationOptionField[]> {
  if (!optionId) return [];

  const mun = await getMunBySlug(slug);
  if (!mun) return [];

  const options = await listAccommodationOptions(mun.id);
  const option = options.filter(isSelectableOption).find((entry) => entry.id === optionId);
  if (!option) return [];

  return listAccommodationOptionFields(option.id);
}

export interface PaymentAvailability {
  registrationProductId: string;
  capacity: number;
  taken: number;
  available: number;
}

/** Batches availability lookups for the product picker. */
export async function loadAvailability(
  registrationProductIds: string[],
): Promise<PaymentAvailability[]> {
  return Promise.all(
    registrationProductIds.map(async (registrationProductId) => {
      const availability = await getProductAvailability(registrationProductId);
      return { registrationProductId, ...availability };
    }),
  );
}

/**
 * Mock checkout submit. Signs a provider-shaped payload server-side and posts
 * it to the real webhook route, exactly as Razorpay would — the HMAC secret
 * never reaches the browser, and confirmation still happens only in the
 * webhook handler.
 *
 * Ownership is enforced before signing anything: `getRegistrationById` throws
 * `Forbidden` if the caller doesn't own this registration, so one student can't
 * drive another student's payment.
 */
export async function completeMockPaymentAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const registrationId = String(formData.get("registrationId") ?? "");
  const outcome = String(formData.get("outcome") ?? "") === "failure" ? "failure" : "success";

  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/register/${slug}`)}`);
  }

  // Throws Forbidden for a non-owner; returns null for an unknown id.
  const registration = await getRegistrationById(registrationId, session);
  if (!registration) {
    redirect(`/register/${slug}`);
  }

  const { orderId } = await getOrderIdForRegistration(registrationId);
  const { payload, signature } = await simulatePaymentOutcome(orderId, outcome);

  // Derived from the incoming request rather than a hardcoded/env-configured
  // origin — a fixed "http://localhost:3000" fallback would silently break
  // this self-call under any deployment target (e.g. Cloudflare Workers) where
  // that env var isn't set and localhost isn't reachable from the worker.
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const baseUrl = host ? `${protocol}://${host}` : "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/webhooks/payments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": signature,
    },
    body: payload,
  });

  if (!response.ok) {
    redirect(
      `/register/${slug}/pay?registrationId=${encodeURIComponent(registrationId)}&error=webhook`,
    );
  }

  redirect(
    `/register/${slug}/confirmation?registrationId=${encodeURIComponent(registrationId)}`,
  );
}

/**
 * Resolves the provider order id for a registration.
 *
 * `initiateRegistration` returns the orderId once at creation time and there is
 * no exported lib-level reader for it, so the checkout page re-reads the
 * payments row it wrote. Kept in this file (not `lib/`) deliberately: `lib/` is
 * frozen for this task.
 */
async function getOrderIdForRegistration(
  registrationId: string,
): Promise<{ orderId: string }> {
  const { db } = await import("@/lib/db/client");
  const { payments } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const [payment] = await db
    .select({ orderId: payments.providerOrderId })
    .from(payments)
    .where(eq(payments.registrationId, registrationId))
    .limit(1);

  if (!payment) {
    throw new Error("No payment order found for this registration");
  }

  return { orderId: payment.orderId };
}
