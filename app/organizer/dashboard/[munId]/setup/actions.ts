"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/lib/session";
import { updateMunDetails } from "@/lib/actions/mun-config";
import type { UpdateMunDetailsInput } from "@/lib/actions/mun-config";
import { uploadMunMedia } from "@/lib/actions/mun-branding";
import { uploadMunDocument } from "@/lib/actions/mun-documents";
import { createScheduleItem } from "@/lib/actions/mun-schedule";
import { upsertMunContact } from "@/lib/actions/mun-contact";
import { createMunFaq } from "@/lib/actions/mun-faq";
import { submitFinalConfirmation } from "@/lib/lifecycle/organizer-confirmation";

/**
 * Server-action wrappers for the MUN Setup module.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * `lib/actions/mun-config.ts` is the frozen backend contract and takes a
 * `Session` as its last argument. A client component can't produce one — and
 * must not be trusted to, since the session IS the authorization input. These
 * wrappers are the boundary where the actor is derived server-side via
 * `getSession()` and where a `FormData` payload is validated into the typed
 * input the contract expects. Nothing here re-implements the ownership check:
 * `assertOwnsOrAdmin` inside `mun-config.ts` does that on every call, using the
 * session this file passes through.
 *
 * `munId` arrives from the client (bound into the form action). That is safe
 * for exactly the same reason the URL segment is: the contract re-derives
 * ownership from the session against that id and throws `Forbidden` on a
 * mismatch, so a tampered id buys nothing.
 *
 * All three actions return state rather than throwing or redirecting. A setup
 * form is an edit-in-place surface — losing what the organizer typed because a
 * date failed to parse would be a worse failure than the failure itself.
 */

export interface SetupFormState {
  status: "idle" | "error" | "success";
  /** Human-readable summary, shown as an inline alert and a toast. */
  message?: string;
  /** Per-field validation messages, keyed by input `name`. */
  fieldErrors?: Record<string, string>;
  /** Echoed back so the form survives a failed submit with input intact. */
  values?: Record<string, string>;
  /**
   * Bumped on every successful save. The client keys its field subtree on this
   * so a save that normalises a value server-side (trimming, date rounding)
   * remounts the inputs with the stored value instead of mutating a live
   * uncontrolled input's `defaultValue` — the Base UI warning documented in
   * `app/organizer/apply/apply-form.tsx`.
   */
  savedAt?: number;
}

export async function saveContactAction(
  munId: string,
  _prev: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  const session = await getSession();
  const values = collect(formData, [
    "officialEmail",
    "phone",
    "website",
    "contactPersonName",
    "contactPersonRole",
    "contactPersonEmail",
    "contactPersonPhone",
  ]);
  const fieldErrors: Record<string, string> = {};
  if (!values.officialEmail.includes("@")) fieldErrors.officialEmail = "Enter a valid email address.";
  if (!values.contactPersonName) fieldErrors.contactPersonName = "Enter a contact name.";
  if (!values.contactPersonEmail.includes("@")) fieldErrors.contactPersonEmail = "Enter a valid email address.";
  if (Object.keys(fieldErrors).length) return { status: "error", message: "Check the highlighted fields and try again.", fieldErrors, values };

  try {
    await upsertMunContact(munId, {
      officialEmail: values.officialEmail,
      phone: values.phone || null,
      website: values.website || null,
      contactPersonName: values.contactPersonName,
      contactPersonRole: values.contactPersonRole || null,
      contactPersonEmail: values.contactPersonEmail,
      contactPersonPhone: values.contactPersonPhone || null,
    }, session);
  } catch (error) { return toErrorState(error, values); }
  revalidatePath(`/organizer/dashboard/${munId}/setup`);
  return { status: "success", message: "Contact details saved.", savedAt: Date.now() };
}

export async function uploadBrandingAction(
  munId: string,
  _prev: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  const file = formData.get("file");
  const kind = String(formData.get("kind") ?? "");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose an image to upload." };
  if (kind !== "LOGO" && kind !== "COVER") return { status: "error", message: "Choose a valid branding asset." };
  try {
    await uploadMunMedia({ munId, kind, file: Buffer.from(await file.arrayBuffer()), contentType: file.type }, await getSession());
  } catch (error) { return toErrorState(error); }
  revalidatePath(`/organizer/dashboard/${munId}/setup`);
  return { status: "success", message: `${kind === "LOGO" ? "Logo" : "Cover image"} saved.`, savedAt: Date.now() };
}

export async function uploadRulesAction(
  munId: string,
  _prev: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  const file = formData.get("file");
  const title = String(formData.get("title") ?? "Rules of procedure").trim();
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a PDF to upload." };
  try {
    await uploadMunDocument({ munId, kind: "RULES", title: title || "Rules of procedure", file: Buffer.from(await file.arrayBuffer()), contentType: file.type }, await getSession());
  } catch (error) { return toErrorState(error); }
  revalidatePath(`/organizer/dashboard/${munId}/setup`);
  return { status: "success", message: "Rules document uploaded.", savedAt: Date.now() };
}

export async function addScheduleItemAction(
  munId: string,
  _prev: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  const values = collect(formData, ["title", "kind", "startsAt", "endsAt", "location"]);
  if (!values.title || !values.startsAt || !values.endsAt) return { status: "error", message: "Enter a title, start time, and end time.", values };
  const startsAt = new Date(values.startsAt);
  const endsAt = new Date(values.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return { status: "error", message: "End time must be after start time.", values };
  try {
    await createScheduleItem({ munId, title: values.title, kind: values.kind as "COMMITTEE_SESSION", startsAt, endsAt, location: values.location || null }, await getSession());
  } catch (error) { return toErrorState(error, values); }
  revalidatePath(`/organizer/dashboard/${munId}/setup`);
  return { status: "success", message: "Schedule item added.", savedAt: Date.now() };
}

export async function addFaqAction(munId: string, _prev: SetupFormState, formData: FormData): Promise<SetupFormState> {
  const values = collect(formData, ["question", "answer"]);
  if (!values.question || !values.answer) return { status: "error", message: "Enter both a question and an answer.", values };
  try { await createMunFaq(munId, values.question, values.answer, await getSession()); }
  catch (error) { return toErrorState(error, values); }
  revalidatePath(`/organizer/dashboard/${munId}/setup`);
  return { status: "success", message: "FAQ added.", savedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Field parsing
// ---------------------------------------------------------------------------

/**
 * Text fields are written as `null` when cleared, not skipped.
 *
 * Every one of these columns is nullable, and "I deleted the theme and saved"
 * has to actually delete it. Omitting empty keys from the update payload would
 * make clearing a field silently impossible — the classic edit-form bug where
 * a value can be changed but never removed. `name` is the exception: it is
 * NOT NULL in the schema and is the mun's identity, so it is required.
 *
 * `UpdateMunDetailsInput`'s nullable fields accept `| null` directly (widened
 * in lib/actions/mun-config.ts after this module flagged the gap), so `null`
 * here means "clear the column" and `undefined` means "leave it alone" —
 * no cast needed.
 */
function optionalText(formData: FormData, field: string): string | null | undefined {
  const raw = formData.get(field);
  if (raw === null) return undefined;
  const trimmed = String(raw).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * `<input type="date">` value ("YYYY-MM-DD") -> Date, or a cleared write.
 */
function parseDateField(
  formData: FormData,
  field: string,
): { value: Date | null | undefined; invalid: boolean } {
  const raw = String(formData.get(field) ?? "").trim();
  if (raw === "") return { value: null, invalid: false };

  // Parsed as UTC midnight (the `YYYY-MM-DD` form is spec'd as UTC), so the
  // stored instant matches the day the organizer picked regardless of where
  // the server runs. Rendering back out uses the same UTC basis — see
  // `toDateInputValue` in `setup-forms.tsx`.
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return { value: undefined, invalid: true };
  return { value: parsed, invalid: false };
}

function collect(formData: FormData, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [field, String(formData.get(field) ?? "").trim()]),
  );
}

/**
 * Maps a thrown contract error onto form state.
 *
 * `Forbidden` / `Mun not found` are the two the contract raises by name; they
 * mean the actor lost access mid-session (or is probing), and they deserve
 * distinct copy from a generic fault so the organizer isn't told to "try
 * again" on something retrying will never fix.
 */
function toErrorState(error: unknown, values?: Record<string, string>): SetupFormState {
  const raw = error instanceof Error ? error.message : "";

  if (raw === "Forbidden") {
    return {
      status: "error",
      message: "You no longer have permission to edit this conference.",
      values,
    };
  }
  if (raw === "Mun not found") {
    return { status: "error", message: "This conference no longer exists.", values };
  }
  return {
    status: "error",
    message: "Something went wrong saving your changes. Please try again.",
    values,
  };
}

// ---------------------------------------------------------------------------
// General — name, edition, theme, description
// ---------------------------------------------------------------------------

const GENERAL_FIELDS = ["name", "edition", "theme", "description"] as const;

export async function saveGeneralAction(
  munId: string,
  _prev: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  const session = await getSession();
  const values = collect(formData, GENERAL_FIELDS);
  const fieldErrors: Record<string, string> = {};

  if (!values.name) {
    fieldErrors.name = "Enter a conference name.";
  } else if (values.name.length > 200) {
    fieldErrors.name = "Keep the name under 200 characters.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors,
      values,
    };
  }

  const input: UpdateMunDetailsInput = {
    name: values.name,
    edition: optionalText(formData, "edition"),
    theme: optionalText(formData, "theme"),
    description: optionalText(formData, "description"),
  };

  try {
    await updateMunDetails(munId, input, session);
  } catch (error) {
    return toErrorState(error, values);
  }

  revalidatePath(`/organizer/dashboard/${munId}`, "layout");
  return { status: "success", message: "General details saved.", savedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Dates & venue — startDate, endDate, venue, city, country
// ---------------------------------------------------------------------------

const VENUE_FIELDS = ["startDate", "endDate", "venue", "city", "country"] as const;

export async function saveDatesVenueAction(
  munId: string,
  _prev: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  const session = await getSession();
  const values = collect(formData, VENUE_FIELDS);
  const fieldErrors: Record<string, string> = {};

  const start = parseDateField(formData, "startDate");
  const end = parseDateField(formData, "endDate");

  if (start.invalid) fieldErrors.startDate = "Enter a valid start date.";
  if (end.invalid) fieldErrors.endDate = "Enter a valid end date.";

  // Only meaningful when both parsed. A conference that ends before it starts
  // would break every downstream date range (marketplace filters, the delegate
  // countdown), so it is rejected here rather than stored and worked around.
  if (start.value && end.value && end.value < start.value) {
    fieldErrors.endDate = "The end date can't be before the start date.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors,
      values,
    };
  }

  const input: UpdateMunDetailsInput = {
    startDate: start.value,
    endDate: end.value,
    venue: optionalText(formData, "venue"),
    city: optionalText(formData, "city"),
    country: optionalText(formData, "country"),
  };

  try {
    await updateMunDetails(munId, input, session);
  } catch (error) {
    return toErrorState(error, values);
  }

  revalidatePath(`/organizer/dashboard/${munId}`, "layout");
  return { status: "success", message: "Dates & venue saved.", savedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Final confirmation (Gate 3)
// ---------------------------------------------------------------------------

export interface SubmitVerificationState {
  status: "idle" | "error" | "success";
  message?: string;
}

/**
 * Gate 3 — the organizer's binding "I confirm this is accurate and
 * authorized for publication" (PRD §14). Calls `submitFinalConfirmation`
 * directly, which snapshots mun+committees+portfolios+products into
 * `organizer_confirmations` and performs the CONTENT_SUBMITTED ->
 * ORGANIZER_CONFIRMATION -> VERIFICATION hop as two audit-logged steps.
 *
 * This replaces the old `submitForVerificationAction` (removed), which
 * called `submitMunForVerification` — a lighter compatibility shim in
 * `lib/actions/mun-config.ts` that performs the same two-hop transition but
 * writes no confirmation snapshot. `FinalConfirmationPanel` is the only
 * caller of this action; nothing else in the tree still calls the old one.
 *
 * Valid from CONTENT_SUBMITTED only. The UI disables the trigger outside
 * that status, but this action does not rely on that: the state machine
 * row-locks the mun and re-validates the transition inside its own DB
 * transaction, so a stale tab that submits twice gets a plain "no longer
 * awaiting submission" message instead of writing a duplicate audit row or
 * confirmation snapshot.
 */
export async function submitFinalConfirmationAction(
  munId: string,
  _prev: SubmitVerificationState,
  _formData: FormData,
): Promise<SubmitVerificationState> {
  const session = await getSession();

  try {
    await submitFinalConfirmation(munId, session);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";

    if (raw.startsWith("Invalid transition") || raw.includes("CONTENT_SUBMITTED")) {
      return {
        status: "error",
        message:
          "This conference is no longer awaiting submission — reload the page to see its current status.",
      };
    }
    if (raw === "Forbidden") {
      return {
        status: "error",
        message: "You no longer have permission to submit this conference.",
      };
    }
    return {
      status: "error",
      message: "Something went wrong submitting your confirmation. Please try again.",
    };
  }

  revalidatePath(`/organizer/dashboard/${munId}`, "layout");
  return { status: "success", message: "Confirmed and submitted for verification." };
}
