/** Organizer-facing committee shape — mirrors the server's committees table columns exactly. */
export interface Committee {
  id: string;
  munId: string;
  name: string;
  agenda: string | null;
  description: string | null;
  capacity: number;
  committeeType: string | null;
  portfoliosEnabled: boolean;
  createdAt: string;
}

/**
 * Create/update payload — matches `createCommitteeBodySchema`/
 * `updateCommitteeBodySchema` in `server/routes/mun-config.ts` exactly
 * (both are `.strict()`, so no extra keys). `committeeType`/
 * `portfoliosEnabled` aren't accepted by those actions yet, so they're
 * display-only fields on `Committee` above, not part of this input.
 */
export interface CommitteeInput {
  name: string;
  agenda: string;
  description: string;
  capacity: number;
}
