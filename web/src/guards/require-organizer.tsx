import type { ReactNode } from "react";
import { RequireAuth } from "@/guards/require-auth";
import { RequireRole } from "@/guards/require-role";

const ORGANIZER_ONLY = ["ORGANIZER"] as const;

/**
 * Gate for the organizer workspace and the host application: signed in, and
 * signed in as an ORGANIZER. Delegate accounts never become organizer
 * accounts, so a delegate who lands here gets told the two are separate
 * instead of seeing organizer tools. UX only — the API enforces the same rule.
 */
export function RequireOrganizer({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <RequireRole
        roles={ORGANIZER_ONLY}
        description="This area is for organizer accounts. Organizer and delegate accounts are separate, and the account you're signed in with isn't an organizer account."
      >
        {children}
      </RequireRole>
    </RequireAuth>
  );
}
