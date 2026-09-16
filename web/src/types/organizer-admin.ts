export interface OrganizerRow {
  id: string;
  name: string;
  email: string;
  institution: string | null;
  suspended: boolean;
  suspendedReason: string | null;
  suspendedAt: string | null;
  createdAt: string;
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
