import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/adapter";
import type { Role } from "@/lib/db/schema-enums";

/**
 * The organizer-workspace access rule, in one place.
 *
 * Preserves the gate the pre-split single-page dashboard shipped with: signed
 * out redirects to `/login` carrying a `redirectTo`, wrong role redirects to
 * the marketplace root. Extracted from that page so `layout.tsx` can apply it
 * once for all 17 sections and no module page has to remember to.
 *
 * `redirect()` throws, so the non-null return type is honest: if this function
 * returns at all, `session` was non-null and allowed.
 */

/** PRD § 28 roles that may operate a conference. */
const ALLOWED_ROLES = new Set<Role>(["ORGANIZER", "ADMIN", "SUPER_ADMIN"]);

export function requireOrganizerSession(session: Session | null): Session {
  if (!session) {
    redirect("/login?redirectTo=/organizer/dashboard");
  }
  if (!ALLOWED_ROLES.has(session.role)) {
    redirect("/");
  }
  return session;
}

/**
 * `getSession()` + the gate, deduped per request.
 *
 * Three server components need the actor on a single workspace render (the
 * gate layout, the shell layout, and usually the page). `lib/auth/session.ts`
 * is a frozen contract and isn't memoised, so wrapping it here turns three
 * identical session-table round trips into one. Layouts can't pass values to
 * one another, so re-reading is unavoidable — re-querying is not.
 */
export const requireOrganizerActor = cache(async (): Promise<Session> => {
  return requireOrganizerSession(await getSession());
});
