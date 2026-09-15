"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/lib/session";
import {
  createAccommodationOption,
  createAccommodationOptionField,
  deleteAccommodationOption,
  deleteAccommodationOptionField,
  updateAccommodationOption,
  updateAccommodationOptionField,
} from "@/lib/actions/accommodation";
import type { AccommodationFieldType } from "@/lib/db/schema-enums";
// NOTE: `FIELD_TYPES` / `isChoiceFieldType` live in their own module, NOT here.
// A "use server" file may only export async functions, so a constant array or a
// sync predicate exported from this file is a build error that `tsc --noEmit`
// does not catch. See the header of `./field-types.ts`.
import { FIELD_TYPES, isChoiceFieldType } from "./field-types";

/**
 * Route-local wrappers around the frozen `lib/actions/accommodation` surface.
 * Same three-part contract as `products/actions.ts` beside this one:
 *
 *   1. The lib actions THROW (`Forbidden`, `Mun not found`, `Accommodation
 *      option not found`, `Accommodation field not found`, `Field type X
 *      requires at least one choice`, plus raw Postgres errors). A client
 *      component needs a discriminated result it can turn into a toast, not an
 *      unhandled rejection that blanks the page with an error boundary.
 *   2. Every lib action takes `session: Session | null` explicitly — it does
 *      NOT read the cookie itself. `await getSession()` here is the only place
 *      the actor is resolved, and it is resolved SERVER-SIDE. No caller can
 *      supply an identity.
 *   3. The workspace renders dynamically off the session cookie, so a mutation
 *      needs `revalidatePath` or the list lingers in the client router cache.
 *
 * Authorization is deliberately NOT re-implemented here. Every one of the six
 * mutations calls `assertOwnsOrAdmin` internally (resolving option -> munId, or
 * field -> option -> munId, first), so the id arriving from the client is
 * checked against the session's ownership before any write.
 *
 * NOTE the asymmetry with the read path: `queries.ts` DOES need its own
 * ownership check, because the two `list*` functions take no session at all.
 * The mutations do not. See the header of `queries.ts`.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: never } : { data: T }))
  | { ok: false; error: string };

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Forbidden") {
      return "You no longer have permission to edit this conference. Sign in again.";
    }
    if (error.message === "Mun not found") {
      return "This conference no longer exists. Reload the page.";
    }
    if (error.message === "Accommodation option not found") {
      return "That accommodation option was already removed. Reload the page.";
    }
    if (error.message === "Accommodation field not found") {
      return "That field was already removed. Reload the page.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

function revalidateSection(munId: string): void {
  revalidatePath(`/organizer/dashboard/${munId}/accommodation`);
}

// ---------------------------------------------------------------------------
// Accommodation options
// ---------------------------------------------------------------------------

/** Everything the option create/edit dialog collects, pre-coercion. */
export interface OptionFormValues {
  name: string;
  /** Whole major units (rupees), not paise — matches `accommodationOptions.price`. */
  price: number;
  capacity: number;
  description: string;
}

/**
 * Boundary validation. The lib layer trusts its input shape (it is typed, not
 * parsed) and Postgres would accept a negative price or a zero capacity
 * happily — both nonsense that surfaces later as an unsellable option or a free
 * bed. Limits mirror `products/actions.ts` so the two modules reject the same
 * numbers with the same wording.
 */
function validateOption(values: OptionFormValues): string | null {
  if (!values.name.trim()) return "Give the accommodation option a name.";
  if (values.name.trim().length > 120) {
    return "Option name is too long (120 characters max).";
  }
  if (!Number.isInteger(values.price) || values.price < 0) {
    return "Price must be a whole number of rupees, zero or more.";
  }
  if (values.price > 10_000_000) {
    return "Price looks wrong — cap is ₹1,00,00,000.";
  }
  if (!Number.isInteger(values.capacity) || values.capacity < 1) {
    return "Capacity must be at least 1 bed.";
  }
  if (values.capacity > 100_000) {
    return "Capacity looks wrong — cap is 100,000 beds.";
  }
  if (values.description.length > 1000) {
    return "Description is too long (1,000 characters max).";
  }
  return null;
}

export async function createOptionAction(
  munId: string,
  values: OptionFormValues,
): Promise<ActionResult<{ id: string; name: string }>> {
  const invalid = validateOption(values);
  if (invalid) return { ok: false, error: invalid };

  try {
    const session = await getSession();
    const description = values.description.trim();
    const option = await createAccommodationOption(
      {
        munId,
        name: values.name.trim(),
        price: values.price,
        capacity: values.capacity,
        // `CreateAccommodationOptionInput.description` is `string | undefined`
        // (not nullable) — omitting it lets the column keep its NULL default
        // rather than storing an empty string that renders as a blank line.
        ...(description ? { description } : {}),
      },
      session,
    );
    revalidateSection(munId);
    return { ok: true, data: { id: option.id, name: option.name } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function updateOptionAction(
  munId: string,
  optionId: string,
  values: OptionFormValues,
): Promise<ActionResult<{ id: string; name: string }>> {
  const invalid = validateOption(values);
  if (invalid) return { ok: false, error: invalid };

  try {
    const session = await getSession();
    const description = values.description.trim();
    const option = await updateAccommodationOption(
      optionId,
      {
        name: values.name.trim(),
        price: values.price,
        capacity: values.capacity,
        // Unlike create, `UpdateAccommodationOptionInput.description` accepts
        // `string | null`, so clearing the textarea genuinely nulls the column
        // instead of leaving the previous text behind.
        description: description || null,
      },
      session,
    );
    revalidateSection(munId);
    return { ok: true, data: { id: option.id, name: option.name } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

/**
 * ARCHIVE, not a destructive delete — `deleteAccommodationOption` flips
 * `status` to `'inactive'` rather than removing the row, because
 * `registrations.accommodationOptionId` references it and carries payment
 * history. The UI must say "archive", or the organizer will expect the row to
 * disappear and be confused when it stays (greyed out).
 */
export async function archiveOptionAction(
  munId: string,
  optionId: string,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    await deleteAccommodationOption(optionId, session);
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

/**
 * Un-archive. There is no dedicated lib action, but
 * `updateAccommodationOption` accepts `status`, so restoring is the inverse
 * write through the same guarded path. Without this an accidental archive would
 * be irreversible from the UI.
 */
export async function restoreOptionAction(
  munId: string,
  optionId: string,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    await updateAccommodationOption(optionId, { status: "active" }, session);
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Custom fields on an option
// ---------------------------------------------------------------------------

/** Everything the field create/edit dialog collects, pre-coercion. */
export interface FieldFormValues {
  fieldType: string;
  label: string;
  required: boolean;
  choices: string[];
  displayOrder: number;
}

interface NormalisedField {
  fieldType: AccommodationFieldType;
  label: string;
  required: boolean;
  choices: string[];
  displayOrder: number;
}

/**
 * Parse + validate in one pass so the caller gets a value already narrowed to
 * `AccommodationFieldType` rather than a bare string it would have to cast.
 *
 * `fieldType` arrives as a string from a `<select>`; a cast would let a crafted
 * request put an arbitrary value into a pgEnum column and get a raw Postgres
 * "invalid input value for enum" 500. It is checked against the enum's values
 * instead.
 *
 * The choices rule mirrors the backend's own throw condition exactly
 * (`createAccommodationOptionField`: DROPDOWN/CHECKBOX with an empty or missing
 * `choices` throws). Duplicates are rejected too — two identical options in a
 * dropdown are indistinguishable to a delegate and make the stored answer
 * ambiguous.
 */
function normaliseField(values: FieldFormValues): NormalisedField | string {
  const fieldType = FIELD_TYPES.find((type) => type === values.fieldType);
  if (!fieldType) return "Pick a field type.";

  const label = values.label.trim();
  if (!label) return "Give the field a label.";
  if (label.length > 200) return "Label is too long (200 characters max).";

  if (!Number.isInteger(values.displayOrder) || values.displayOrder < 0) {
    return "Display order must be a whole number, zero or more.";
  }
  if (values.displayOrder > 10_000) {
    return "Display order looks wrong — cap is 10,000.";
  }

  const isChoice = isChoiceFieldType(fieldType);
  if (!isChoice) {
    // TEXT / NUMBER / DATE carry no choice list. Anything the dialog left in
    // its choices state is dropped rather than written, so switching a field
    // from DROPDOWN to TEXT doesn't leave orphaned options in the jsonb.
    return { fieldType, label, required: values.required, choices: [], displayOrder: values.displayOrder };
  }

  const choices = values.choices
    .map((choice) => choice.trim())
    .filter((choice) => choice.length > 0);

  if (choices.length === 0) {
    return `A ${fieldType === "DROPDOWN" ? "dropdown" : "checkbox"} field needs at least one choice.`;
  }
  if (choices.length > 100) {
    return "That's too many choices (100 max).";
  }
  if (choices.some((choice) => choice.length > 200)) {
    return "A choice is too long (200 characters max).";
  }

  const seen = new Set(choices.map((choice) => choice.toLowerCase()));
  if (seen.size !== choices.length) {
    return "Choices must be unique.";
  }

  return { fieldType, label, required: values.required, choices, displayOrder: values.displayOrder };
}

export async function createFieldAction(
  munId: string,
  optionId: string,
  values: FieldFormValues,
): Promise<ActionResult<{ id: string; label: string }>> {
  const normalised = normaliseField(values);
  if (typeof normalised === "string") {
    return { ok: false, error: normalised };
  }

  try {
    const session = await getSession();
    const field = await createAccommodationOptionField(
      {
        optionId,
        fieldType: normalised.fieldType,
        label: normalised.label,
        required: normalised.required,
        // `CreateAccommodationOptionFieldInput.choices` is `string[] |
        // undefined`. For non-choice types it is omitted entirely so the jsonb
        // column stays NULL, matching the schema comment ("null for
        // TEXT/NUMBER/DATE") rather than storing an empty array.
        ...(normalised.choices.length > 0 ? { choices: normalised.choices } : {}),
        displayOrder: normalised.displayOrder,
      },
      session,
    );
    revalidateSection(munId);
    return { ok: true, data: { id: field.id, label: field.label } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function updateFieldAction(
  munId: string,
  fieldId: string,
  values: FieldFormValues,
): Promise<ActionResult<{ id: string; label: string }>> {
  const normalised = normaliseField(values);
  if (typeof normalised === "string") {
    return { ok: false, error: normalised };
  }

  try {
    const session = await getSession();
    const field = await updateAccommodationOptionField(
      fieldId,
      {
        fieldType: normalised.fieldType,
        label: normalised.label,
        required: normalised.required,
        // `UpdateAccommodationOptionFieldInput.choices` accepts `string[] |
        // null`, so switching a DROPDOWN back to TEXT actively CLEARS the old
        // choice list instead of leaving stale options in the column where the
        // registration funnel would still find them.
        choices: normalised.choices.length > 0 ? normalised.choices : null,
        displayOrder: normalised.displayOrder,
      },
      session,
    );
    revalidateSection(munId);
    return { ok: true, data: { id: field.id, label: field.label } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

/**
 * HARD delete, unlike the option archive above — `deleteAccommodationOptionField`
 * removes the row outright, which the lib layer justifies on the grounds that
 * no financial record depends on a field DEFINITION continuing to exist. The
 * confirm copy says "delete" and "cannot be undone" to match that reality.
 */
export async function deleteFieldAction(
  munId: string,
  fieldId: string,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    await deleteAccommodationOptionField(fieldId, session);
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}
