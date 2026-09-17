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

/** A seat delegates can pick in a committee — mirrors the server's portfolios table. */
export interface Portfolio {
  id: string;
  committeeId: string;
  name: string;
  /** Free text; the UI writes one of PORTFOLIO_TYPES. */
  type: string | null;
  /** Seats for this portfolio. 0 means it can't be picked. */
  availability: number;
  description: string | null;
  restrictions: string | null;
  createdAt: string;
}

/** Matches `createPortfolioBodySchema` in server/routes/mun-config.ts (`.strict()`). */
export interface PortfolioInput {
  name: string;
  type?: string;
  availability?: number;
}
