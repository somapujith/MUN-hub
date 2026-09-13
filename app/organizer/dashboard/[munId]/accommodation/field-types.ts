import type { AccommodationFieldType } from "@/lib/db/schema-enums";

/**
 * Shared, NON-server constants for accommodation field types.
 *
 * WHY THIS IS A SEPARATE FILE FROM `actions.ts` (do not fold it back in):
 * `actions.ts` is a `"use server"` module, and such a module may only export
 * ASYNC FUNCTIONS. Every export is rewritten into a callable server-action
 * reference, so a synchronous helper or a plain array exported from there is a
 * build error — "Server Actions must be async functions" — which `tsc
 * --noEmit` does NOT catch, because it is a bundler rule rather than a type
 * rule. It surfaces only when the route actually compiles.
 *
 * Both `actions.ts` (server) and `accommodation-field-dialog.tsx` (client) need
 * this predicate to agree on which types require a choice list, so it lives
 * here where either side may import it.
 */

/** The pgEnum's values, ordered as they appear to an organizer. */
export const FIELD_TYPES = [
  "TEXT",
  "NUMBER",
  "DATE",
  "DROPDOWN",
  "CHECKBOX",
] as const satisfies readonly AccommodationFieldType[];

/**
 * Field types for which `choices` is required and meaningful.
 *
 * Mirrors the backend's own throw condition in
 * `createAccommodationOptionField`: DROPDOWN or CHECKBOX with an empty or
 * missing `choices` throws. Keep the two in sync — this is the client-side
 * mirror, not an independent rule.
 */
const CHOICE_FIELD_TYPES: readonly AccommodationFieldType[] = [
  "DROPDOWN",
  "CHECKBOX",
];

export function isChoiceFieldType(value: AccommodationFieldType): boolean {
  return CHOICE_FIELD_TYPES.includes(value);
}
