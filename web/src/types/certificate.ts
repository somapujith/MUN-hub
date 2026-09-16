/**
 * Minimal read-only shape returned by `GET /muns/:munId/certificates`
 * (`lib/actions/certificates.ts#listCertificates`). No create/update/delete
 * type — certificates are schema-scaffolded, no MVP issuance pipeline yet.
 */
export interface Certificate {
  id: string;
  userId: string;
  munId: string;
  registrationId: string;
  certificateUrl: string | null;
  verificationStatus: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}
