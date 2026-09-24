export interface OrganizerRow {
  id: string;
  name: string;
  email: string;
  institution: string | null;
  suspended: boolean;
  suspendedReason: string | null;
  suspendedAt: string | null;
  createdAt: string;
  /** How many MUNs this organizer runs (any status). Links through to the Conferences console. */
  munCount: number;
}

export interface ListOrganizersResult {
  results: OrganizerRow[];
  total: number;
}

export interface ListOrganizersParams {
  limit?: number;
  offset?: number;
  search?: string;
}
