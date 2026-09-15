import type { MunStatus } from "@/types/enums";

export type SlaState = "ON_TRACK" | "APPROACHING" | "DELAYED" | "PAUSED" | "COMPLETED";

export interface GoLiveQueueRow {
  munId: string;
  munName: string;
  munStatus: MunStatus;
  submissionId: string;
  submissionStatus: string;
  submittedAt: Date | null;
  slaDeadline: Date;
  slaState: SlaState;
  queuedAt: Date | null;
}

export interface GoLiveQueueResult {
  results: GoLiveQueueRow[];
  total: number;
}

export interface AdminQueueCard {
  label: string;
  value: number;
  href: string;
}
