import type { MunStatus } from "@/types/enums";

/**
 * Shapes returned by the results routes (server/routes/results.ts, wrapping
 * lib/actions/results.ts). Dates arrive as ISO strings.
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

/** A row of GET /organizer/muns/:munId/achievements. */
export interface AchievementListRow extends AchievementRow {
  delegateName: string;
  delegateEmail: string;
}

export interface CreateAchievementInput {
  registrationId: string;
  committee?: string | null;
  portfolio?: string | null;
  award: string;
}

export interface ResultsState {
  munStatus: MunStatus;
  awardCount: number;
  /** Awards can be added or removed. */
  editable: boolean;
  /** The MUN is in a state results can be submitted from (at least one award is also required). */
  canSubmit: boolean;
  submittedAt: string | null;
  /** MUNHub's note from the latest return, while the results are back with the organizer. */
  returnNote: string | null;
}
