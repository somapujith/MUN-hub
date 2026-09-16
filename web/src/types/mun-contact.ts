/**
 * Organizer contact record — shape returned by `GET /muns/:munId/contact`
 * (lib/actions/mun-contact.ts#getMunContact) and the `PUT` upsert.
 */
export interface MunContact {
  id: string;
  munId: string;
  officialEmail: string;
  phone: string | null;
  website: string | null;
  socialLinks: Record<string, string> | null;
  contactPersonName: string;
  contactPersonRole: string | null;
  contactPersonEmail: string;
  contactPersonPhone: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Upsert payload — matches `upsertContactBodySchema` in
 * `server/routes/mun-contact.ts` exactly (`.strict()`, so no extra keys).
 */
export interface UpsertMunContactInput {
  officialEmail: string;
  phone?: string | null;
  website?: string | null;
  socialLinks?: Record<string, string> | null;
  contactPersonName: string;
  contactPersonRole?: string | null;
  contactPersonEmail: string;
  contactPersonPhone?: string | null;
}
