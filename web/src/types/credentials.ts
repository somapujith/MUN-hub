/**
 * Shapes returned by `GET /me/credentials`
 * (`lib/actions/student-credentials.ts#listMyCredentials`), with dates revived
 * from their ISO strings by `@/api/credentials`.
 */
export interface MyAchievement {
  id: string;
  munId: string;
  munName: string;
  city: string | null;
  munStartDate: Date | null;
  munEndDate: Date | null;
  committee: string | null;
  portfolio: string | null;
  award: string | null;
  awardedAt: Date;
}

export interface MyCertificate {
  id: string;
  munId: string;
  munName: string;
  city: string | null;
  munStartDate: Date | null;
  munEndDate: Date | null;
  /** An absolute http(s) link to the file, or null when there is nothing to download yet. */
  downloadUrl: string | null;
  /** MUN Hub has verified this certificate. */
  verified: boolean;
  issuedAt: Date;
}

export interface MyCredentials {
  achievements: MyAchievement[];
  certificates: MyCertificate[];
}
