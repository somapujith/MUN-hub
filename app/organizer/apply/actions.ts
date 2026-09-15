"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { submitOrganizerApplication } from "@/lib/actions/organizer-application";

export interface ApplyFormState {
  status: "idle" | "error" | "success";
  /** Human-readable summary shown as a toast / alert. */
  message?: string;
  /** Per-field validation messages, keyed by input `name`. */
  fieldErrors?: Record<string, string>;
  /** Echoed back so the form re-renders with the user's input intact on error. */
  values?: Record<string, string>;
}

const FIELDS = [
  "conferenceName",
  "location",
  "expectedDate",
  "expectedDelegateCount",
  "description",
  "previousEditions",
  "websiteUrl",
] as const;

function readValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    FIELDS.map((field) => [field, String(formData.get(field) ?? "").trim()]),
  );
}

/**
 * Validates and submits an organizer application.
 *
 * Returns state instead of redirecting on failure so the form can render
 * per-field errors inline and keep what the user typed. Success still
 * redirects to the confirmation route — `redirect()` throws, so it must sit
 * outside the try/catch that maps DB failures onto form state.
 */
export async function submitApplicationAction(
  _prev: ApplyFormState,
  formData: FormData,
): Promise<ApplyFormState> {
  const session = await getSession();
  if (!session) {
    redirect("/login?redirectTo=/organizer/apply");
  }

  const values = readValues(formData);
  const fieldErrors: Record<string, string> = {};

  if (!values.conferenceName) {
    fieldErrors.conferenceName = "Enter the name of your conference.";
  }
  if (!values.location) {
    fieldErrors.location = "Enter the host city.";
  }

  const expectedDate = values.expectedDate ? new Date(values.expectedDate) : null;
  if (!expectedDate || Number.isNaN(expectedDate.getTime())) {
    fieldErrors.expectedDate = "Choose an expected start date.";
  }

  const delegateCount = Number(values.expectedDelegateCount);
  if (
    !values.expectedDelegateCount ||
    !Number.isFinite(delegateCount) ||
    !Number.isInteger(delegateCount) ||
    delegateCount < 1
  ) {
    fieldErrors.expectedDelegateCount = "Enter a whole number of delegates (1 or more).";
  }

  if (values.description.length < 40) {
    fieldErrors.description =
      "Tell us a bit more — at least 40 characters about your conference.";
  }

  if (values.websiteUrl) {
    try {
      const parsed = new URL(values.websiteUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("bad protocol");
      }
    } catch {
      fieldErrors.websiteUrl = "Enter a full URL, including https://";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors,
      values,
    };
  }

  try {
    await submitOrganizerApplication({
      organizerId: session.userId,
      conferenceName: values.conferenceName,
      location: values.location,
      expectedDate: expectedDate as Date,
      expectedDelegateCount: delegateCount,
      description: values.description,
      previousEditions: values.previousEditions || undefined,
      websiteUrl: values.websiteUrl || undefined,
    });
  } catch (error) {
    // `organizer_applications.organizer_id` is UNIQUE — one application per
    // organizer, ever. A second submission surfaces as a Postgres 23505, which
    // is a real product rule, not a transient fault, so it gets its own copy.
    const message = error instanceof Error ? error.message : "";
    const isDuplicate =
      message.includes("organizer_applications_organizer_id_unique") ||
      message.includes("duplicate key");

    return {
      status: "error",
      message: isDuplicate
        ? "You already have an application on file. Track its progress from your dashboard."
        : "Something went wrong submitting your application. Please try again.",
      values,
    };
  }

  redirect("/organizer/apply/submitted");
}
