/**
 * Public contact + legal facts rendered on the About, Contact and Legal
 * pages. Kept in one place so a change (a new inbox, a registered entity
 * name, a policy revision date) lands on every page at once.
 *
 * `legalName`/`address`/`phone`/`emails.owner` are the real, confirmed
 * business details (given directly by the business owner, 2026-09-18) used
 * for payment-gateway KYC/website verification. The four `@munhub.in`
 * mailboxes below are still UNCONFIRMED — TODO(launch): verify each one
 * actually receives mail before relying on it, and have the policy text
 * reviewed by counsel.
 */
export const SITE_INFO = {
  name: "MUN Hub",
  /** The registered legal entity operating the Platform. */
  legalName: "MUN Hub",
  entityType: "Proprietorship",
  domain: "munhub.in",
  /** E.164, for display/tel: links. */
  phone: "+919701521369",
  phoneDisplay: "+91 97015 21369",
  address: {
    line1: "18-252/A, Vediri Township, Street 5A, Miyapur",
    city: "Hyderabad",
    state: "Telangana",
    postalCode: "500049",
    country: "India",
    /** One line, for compact spots like the footer. */
    get oneLine() {
      return `${this.line1}, ${this.city}, ${this.state} ${this.postalCode}, ${this.country}`;
    },
  },
  emails: {
    /** Delegates: registrations, payments, account access. */
    support: "support@munhub.in",
    /** Organizers: listing enquiries and existing workspaces. */
    organizers: "organizers@munhub.in",
    /** Data requests; also the Grievance Officer's inbox. */
    privacy: "privacy@munhub.in",
    /** Partnerships, press, and everything else. */
    hello: "hello@munhub.in",
    /** The business owner's own inbox — confirmed real and monitored. */
    owner: "officialmunhubindia@gmail.com",
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

export function tel(phone: string): string {
  return `tel:${phone}`;
}

export function mailto(address: string): string {
  return `mailto:${address}`;
}
