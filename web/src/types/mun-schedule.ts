/** Mirrors lib/db/schema-enums.ts's scheduleItemKindEnum. */
export type ScheduleItemKind =
  | "OPENING_CEREMONY"
  | "COMMITTEE_SESSION"
  | "BREAK"
  | "LUNCH"
  | "CRISIS"
  | "CLOSING_CEREMONY"
  | "AWARDS"
  | "OTHER";

export interface ScheduleItem {
  id: string;
  munId: string;
  committeeId: string | null;
  title: string;
  kind: ScheduleItemKind;
  startsAt: string;
  endsAt: string;
  location: string | null;
  displayOrder: number;
  createdAt: string;
}

export interface ScheduleItemInput {
  committeeId?: string | null;
  title: string;
  kind: ScheduleItemKind;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  displayOrder?: number;
}

export interface ScheduleCommittee {
  id: string;
  name: string;
}
