/**
 * The organizer-editable fields on a Gate-1 application, with their display
 * labels — mirrors `lib/actions/organizer-application.ts`'s
 * `APPLICATION_FIELD_KEYS`/`APPLICATION_FIELD_LABELS` (kept as a duplicate,
 * not an import, same pattern as e.g. UPI_PATTERN between
 * organizer-onboarding.ts and settings-page.tsx — /web doesn't import /lib
 * directly). Used by the admin review page's "fields needing correction"
 * checkboxes and by the organizer-facing apply/resubmit pages to show which
 * fields were flagged.
 */
export const ORGANIZER_APPLICATION_FIELDS = [
  { key: "conferenceName", label: "Title of your MUN" },
  { key: "location", label: "Host city" },
  { key: "expectedDate", label: "Expected start date" },
  { key: "expectedDelegateCount", label: "Maximum delegates you expect" },
  { key: "description", label: "About your MUN" },
  { key: "previousEditions", label: "Previous editions" },
  { key: "websiteUrl", label: "Website" },
] as const;

export type ApplicationFieldKey = (typeof ORGANIZER_APPLICATION_FIELDS)[number]["key"];

const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  ORGANIZER_APPLICATION_FIELDS.map((field) => [field.key, field.label]),
);

/** The display label for a flagged field key, or the raw key if it's somehow unrecognized. */
export function applicationFieldLabel(key: string): string {
  return LABEL_BY_KEY[key] ?? key;
}
