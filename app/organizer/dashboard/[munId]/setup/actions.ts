"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { submitMunForVerification, updateMunDetails } from "@/lib/actions/mun-config";
import type { UpdateMunDetailsInput } from "@/lib/actions/mun-config";

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
 * The `as never` on the return is load-bearing and narrow in blast radius:
 * `UpdateMunDetailsInput` spells these as `field?: string`, but the columns
 * they map to are nullable and Drizzle writes a literal `null` for a `null`
 * value versus skipping the column entirely for `undefined`. Clearing a field
 * therefore requires passing `null` through an input type that doesn't admit
 * it. `lib/**` is frozen contract and out of scope to widen, so the coercion
 * is quarantined to these two helpers rather than sprinkled at call sites.
 * If the contract ever gains `| null`, delete the cast — nothing else changes.
 */
function optionalText(formData: FormData, field: string): string | undefined {
  const raw = formData.get(field);
  if (raw === null) return undefined;
  const trimmed = String(raw).trim();
  return (trimmed === "" ? null : trimmed) as never;
}

/**
 * `<input type="date">` value ("YYYY-MM-DD") -> Date, or a cleared write.
 * Same `as never` quarantine as `optionalText` — see the note there.
 */
function parseDateField(
  formData: FormData,
  field: string,
): { value: Date | undefined; invalid: boolean } {
  const raw = String(formData.get(field) ?? "").trim();
  if (raw === "") return { value: null as never, invalid: false };

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
// Verification submission
// ---------------------------------------------------------------------------

export interface SubmitVerificationState {
  status: "idle" | "error" | "success";
  message?: string;
}

/**
 * Hands the conference to the review team. Valid from CONTENT_SUBMITTED only —
 * `ALLOWED_TRANSITIONS` in `lib/lifecycle/mun-state-machine.ts` lists
 * `CONTENT_SUBMITTED: ['VERIFICATION']` and VERIFICATION appears as a target
 * from nowhere else.
 *
 * The UI disables the button outside that status, but this action does not
 * rely on that: the state machine row-locks the mun and re-validates the
 * transition inside its own DB transaction, so a stale tab that submits twice
 * gets `Invalid transition from VERIFICATION to VERIFICATION` on the second
 * attempt instead of writing a duplicate audit row. That message is mapped to
 * plain copy below rather than surfaced raw.
 */
export async function submitForVerificationAction(
  munId: string,
  _prev: SubmitVerificationState,
  _formData: FormData,
): Promise<SubmitVerificationState> {
  const session = await getSession();

  try {
    await submitMunForVerification(munId, session);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";

    if (raw.startsWith("Invalid transition")) {
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
      message: "Something went wrong submitting for verification. Please try again.",
    };
  }

  revalidatePath(`/organizer/dashboard/${munId}`, "layout");
  return { status: "success", message: "Submitted for verification." };
}
