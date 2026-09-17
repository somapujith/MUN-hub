/**
 * Public contact + legal facts rendered on the About, Contact and Legal
 * pages. Kept in one place so a change (a new inbox, a registered entity
 * name, a policy revision date) lands on every page at once.
 *
 * TODO(launch): confirm each value with the business before treating these
 * pages as binding — every mailbox below must actually receive mail, and the
 * policy text has not yet been reviewed by counsel.
 */
export const SITE_INFO = {
  name: "MUN Hub",
  domain: "munhub.in",
  emails: {
    /** Delegates: registrations, payments, account access. */
    support: "support@munhub.in",
    /** Organizers: listing enquiries and existing workspaces. */
    organizers: "organizers@munhub.in",
    /** Data requests; also the Grievance Officer's inbox. */
    privacy: "privacy@munhub.in",
    /** Partnerships, press, and everything else. */
    hello: "hello@munhub.in",
  },
  governingLaw: "the laws of India",
  courts: "Hyderabad, Telangana",
  /**
   * Shown as "Last updated" on every legal page. When the Terms or Privacy
   * policy text changes, bump this AND the matching version constants in
   * lib/actions/auth.ts (`CURRENT_TERMS_OF_SERVICE_VERSION` /
   * `CURRENT_PRIVACY_POLICY_VERSION`, currently "2026-09-17"), which are
   * recorded against each user's consent.
   */
  policiesLastUpdated: "17 September 2026",
} as const;

export function mailto(address: string): string {
  return `mailto:${address}`;
}
