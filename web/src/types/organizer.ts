import type { MunStatus } from "@/types/enums";

/** Sidebar switcher shape — mirrors app/organizer/dashboard/workspace-queries. */
export interface WorkspaceMun {
  id: string;
  name: string;
  slug: string;
  edition: string | null;
  status: MunStatus;
}

export interface OrganizerWorkspaceTotals {
  registrations: number;
  confirmed: number;
  pending: number;
  capacity: number;
  availableSeats: number;
}

export interface OrganizerMunSummary extends WorkspaceMun {
  startDate: Date | null;
  endDate: Date | null;
  registrationCount: number;
  confirmedCount: number;
  capacity: number;
}
