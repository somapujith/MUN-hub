import type {
  AccommodationOption,
  AccommodationOptionField,
} from "@/lib/actions/accommodation";

/**
 * Shared, dependency-free helpers for the accommodation step.
 *
 * Lives in `components/` rather than `lib/` because `lib/**` is frozen for this
 * task. Imported by BOTH the client step component and the server action, so it
 * must stay free of `"use client"`/`"use server"` directives and of any db or
 * React import.
 */

/**
 * ANSWER KEY SHAPE (load-bearing contract).
 *
 * `initiateRegistration` persists `accommodationAnswers` verbatim into the
 * `registrations.accommodation_answers` jsonb column and never parses it, so
 * the shape is defined entirely here. We key by the field's **id** — labels are
 * organizer-editable and non-unique, ids are stable and survive a rename.
 *
 * Each entry also carries `label` and `fieldType` denormalized so an organizer
 * reading a registration row (or a CSV export) can render the answers without
 * re-joining `accommodation_option_fields` — which matters because the field
 * definition may have been edited or deleted after the student submitted.
 *
 *   {
 *     "<fieldId>": {
 *       label: "Arrival date",
 *       fieldType: "DATE",
 *       value: "2027-03-09"           // string | number | string[] | null
 *     }
 *   }
 */
export interface AccommodationAnswer {
  label: string;
  fieldType: AccommodationOptionField["fieldType"];
  value: string | number | string[] | null;
}

export type AccommodationAnswers = Record<string, AccommodationAnswer>;

/** The "no accommodation" sentinel. Never sent to the server as an id. */
export const NO_ACCOMMODATION = "" as const;

/**
 * `choices` is `unknown` on the field type (jsonb). Narrow it defensively —
 * a DROPDOWN whose choices were nulled out by an organizer edit must render as
 * an empty list, not crash the whole funnel.
 */
export function fieldChoices(field: AccommodationOptionField): string[] {
  if (!Array.isArray(field.choices)) return [];
  return field.choices.filter((choice): choice is string => typeof choice === "string");
}

/** Only `status === 'active'` options are purchasable — `listAccommodationOptions`
 * returns every row regardless of status (it does NOT filter), and
 * `initiateRegistration` rejects a non-active option with
 * "Accommodation option is not available". Filter here so we never show one. */
export function isSelectableOption(option: AccommodationOption): boolean {
  return option.status === "active";
}

/** The raw per-field client state before it's shaped into `AccommodationAnswers`. */
export type FieldValue = string | string[];

export function emptyValueFor(field: AccommodationOptionField): FieldValue {
  return field.fieldType === "CHECKBOX" ? [] : "";
}

/** True when a required field has nothing usable in it. */
export function isMissing(field: AccommodationOptionField, value: FieldValue | undefined): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return value.trim() === "";
}

export interface FieldValidationError {
  fieldId: string;
  label: string;
  message: string;
}

/**
 * Validates raw field values against their definitions.
 *
 * Run on the client to gate step progression AND re-run on the server against
 * freshly-read field definitions — the client copy is advisory only, a crafted
 * POST skips it entirely.
 */
export function validateFieldValues(
  fields: AccommodationOptionField[],
  values: Record<string, FieldValue>,
): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  for (const field of fields) {
    const value = values[field.id];

    if (isMissing(field, value)) {
      if (field.required) {
        errors.push({
          fieldId: field.id,
          label: field.label,
          message: `${field.label} is required.`,
        });
      }
      // Empty + optional: nothing further to check.
      continue;
    }

    if (field.fieldType === "NUMBER") {
      const raw = String(value);
      if (!Number.isFinite(Number(raw))) {
        errors.push({
          fieldId: field.id,
          label: field.label,
          message: `${field.label} must be a number.`,
        });
      }
      continue;
    }

    if (field.fieldType === "DATE") {
      const raw = String(value);
      // `<input type="date">` always emits YYYY-MM-DD; anything else is forged.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
        errors.push({
          fieldId: field.id,
          label: field.label,
          message: `${field.label} must be a valid date.`,
        });
      }
      continue;
    }

    if (field.fieldType === "DROPDOWN") {
      const allowed = fieldChoices(field);
      if (!allowed.includes(String(value))) {
        errors.push({
          fieldId: field.id,
          label: field.label,
          message: `${field.label} has an invalid selection.`,
        });
      }
      continue;
    }

    if (field.fieldType === "CHECKBOX") {
      const allowed = fieldChoices(field);
      const picked = Array.isArray(value) ? value : [String(value)];
      if (picked.some((choice) => !allowed.includes(choice))) {
        errors.push({
          fieldId: field.id,
          label: field.label,
          message: `${field.label} has an invalid selection.`,
        });
      }
      continue;
    }
  }

  return errors;
}

/**
 * Shapes validated raw values into the persisted `AccommodationAnswers` blob.
 * Optional fields left blank are omitted entirely rather than stored as `""`,
 * so an organizer reading the row can tell "unanswered" from "answered empty".
 */
export function toAnswers(
  fields: AccommodationOptionField[],
  values: Record<string, FieldValue>,
): AccommodationAnswers {
  const answers: AccommodationAnswers = {};

  for (const field of fields) {
    const value = values[field.id];
    if (isMissing(field, value)) continue;

    answers[field.id] = {
      label: field.label,
      fieldType: field.fieldType,
      value:
        field.fieldType === "NUMBER"
          ? Number(String(value))
          : field.fieldType === "CHECKBOX"
            ? (value as string[])
            : String(value),
    };
  }

  return answers;
}

/**
 * Wire format for the hidden input. The whole raw value map travels as one JSON
 * string so the action works identically whether the user stepped through the
 * form or POSTed it directly (the same reason every other value here is a
 * hidden field).
 */
export function serializeFieldValues(values: Record<string, FieldValue>): string {
  return JSON.stringify(values);
}

/** Parses the hidden input back, tolerating garbage — a malformed blob becomes
 * `{}` and then fails required-field validation with a real message, rather
 * than throwing a 500 out of the server action. */
export function parseFieldValues(raw: string): Record<string, FieldValue> {
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const result: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") {
      result[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = String(value);
    } else if (Array.isArray(value)) {
      result[key] = value.filter((v): v is string => typeof v === "string");
    }
    // Anything else (object, boolean, null) is dropped — it can't have come
    // from one of our five input types.
  }
  return result;
}
