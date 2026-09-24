/**
 * Vocabulary for the admin Audit Log page's action-type filter.
 *
 * Mirrors `adminActionEnum` (lib/db/schema-enums.ts) plus the three Gate 1
 * organizer-application labels `listAdminActions` (lib/actions/admin-audit.ts)
 * synthesizes from `verification_logs` as `APPLICATION_*` (see
 * `GATE1_AUDIT_ACTIONS` there) — together, every distinct value the feed's
 * coalesced `action` column can hold.
 *
 * Manually mirrored rather than fetched, following the same tradeoff
 * `web/src/types/enums.ts` already makes for every other backend enum: the
 * frontend has no drizzle access, the server has no "list my own enum"
 * endpoint, and this list changes rarely enough that a hand-kept mirror is
 * simpler than adding one.
 */
export const ACTION_TYPE_OPTIONS = [
  { value: "ORGANIZER_SUSPENDED", label: "Organizer suspended" },
  { value: "ORGANIZER_REINSTATED", label: "Organizer reinstated" },
  { value: "MUN_UNPUBLISHED", label: "MUN unpublished" },
  { value: "MUN_SUSPENDED", label: "MUN suspended" },
  { value: "TICKET_ASSIGNED", label: "Support ticket assigned" },
  { value: "TICKET_RESOLVED", label: "Support ticket resolved" },
  { value: "USER_SUSPENDED", label: "User suspended" },
  { value: "MODULE_REQUIREMENT_CHANGED", label: "Module requirement changed" },
  { value: "MUN_PUBLISHED", label: "MUN published" },
  { value: "MUN_APPROVED", label: "MUN content approved" },
  { value: "MUN_REJECTED", label: "MUN content rejected" },
  { value: "MUN_CHANGES_REQUESTED", label: "MUN changes requested" },
  { value: "MODULE_REVIEWED", label: "Module reviewed" },
  { value: "PAYMENT_DETAILS_CHANGED", label: "Payment details changed" },
  { value: "PAYMENT_EXCEPTION_RESOLVED", label: "Payment exception resolved" },
  { value: "STAFF_CREATED", label: "Staff account created" },
  { value: "STAFF_ROLE_CHANGED", label: "Staff role changed" },
  { value: "STAFF_SUSPENDED", label: "Staff suspended" },
  { value: "STAFF_REINSTATED", label: "Staff reinstated" },
  { value: "STAFF_SET_PASSWORD_LINK_ISSUED", label: "Staff password link issued" },
  { value: "STAFF_MFA_RESET", label: "Staff MFA reset" },
  { value: "SUPER_ADMIN_BOOTSTRAPPED", label: "Super admin bootstrapped" },
  // Only meaningful when "Show staff reads of delegate data" is also on —
  // the server leaves PII_READ rows out of the feed entirely otherwise, so
  // audit-page.tsx hides this option unless that checkbox is checked.
  { value: "PII_READ", label: "Staff read of delegate data" },
  { value: "ACCOUNT_DELETED", label: "Account deleted" },
  // Gate 1 organizer-application decisions — synthesized labels, not real
  // admin_action enum values (see GATE1_AUDIT_ACTIONS in admin-audit.ts).
  { value: "APPLICATION_APPROVED", label: "Organizer application approved" },
  { value: "APPLICATION_REJECTED", label: "Organizer application rejected" },
  { value: "APPLICATION_CHANGES_REQUESTED", label: "Organizer application changes requested" },
] as const satisfies readonly { value: string; label: string }[];

export type AuditActionTypeValue = (typeof ACTION_TYPE_OPTIONS)[number]["value"];
