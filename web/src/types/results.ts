/**
 * Shapes returned by the results routes (server/routes/results.ts, wrapping
 * lib/actions/results.ts). Minimal scaffolding over the `achievements` table
 * — see lib/actions/results.ts's header comment for why this stays a plain
 * list + manual add + delete rather than a full awards/verification system.
 */
export interface AchievementRow {
  id: string;
  userId: string;
  munId: string;
  registrationId: string;
  committee: string | null;
  portfolio: string | null;
  award: string | null;
  verificationStatus: string;
  createdAt: string;
}

export interface CreateAchievementInput {
  registrationId: string;
  committee?: string | null;
  portfolio?: string | null;
  award: string;
}
