import "server-only";

import { cache } from "react";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { muns } from "@/lib/db/schema";
import type { MunStatus, Role } from "@/lib/db/schema-enums";

/**
 * Shell-level reads for the organizer workspace: the MUN switcher list and the
 * per-MUN context header. Deliberately minimal — module pages call the frozen
 * `lib/actions/*` contract for their own data. This file exists only because
 * that contract has no "which muns does this organizer own" entry point (see
 * the same note in `./queries.ts`).
 *
 * Both functions are wrapped in React `cache()` so the layout, the page and
 * `generateMetadata` share one query per request instead of three.
 *
 * IDOR: `organizerId` always comes from a server-side `getSession()` in the
 * layout, never from a param or body. `getWorkspaceMun` takes a munId from the
 * URL and therefore returns null unless the caller-supplied session actually
 * owns it — the caller must treat null as `notFound()`, which is what
 * `[munId]/layout.tsx` does.
 */

/** Roles that may read any organizer's workspace. */
const ELEVATED_ROLES: readonly Role[] = ["ADMIN", "SUPER_ADMIN"];

export interface WorkspaceMun {
  id: string;
  name: string;
  slug: string;
  edition: string | null;
  status: MunStatus;
}

/**
 * Every MUN the organizer owns, newest first, for the sidebar switcher.
 * Admins reviewing a listing see the full catalogue ordered by name — they
 * have no "own" muns, and an empty switcher would strand them.
 */
export const listWorkspaceMuns = cache(
  async (organizerId: string, role: Role): Promise<WorkspaceMun[]> => {
    const columns = {
      id: muns.id,
      name: muns.name,
      slug: muns.slug,
      edition: muns.edition,
      status: muns.status,
    };

    if (ELEVATED_ROLES.includes(role)) {
      return db.select(columns).from(muns).orderBy(asc(muns.name)).limit(200);
    }

    return db
      .select(columns)
      .from(muns)
      .where(eq(muns.organizerId, organizerId))
      .orderBy(desc(muns.createdAt));
  },
);

/**
 * One MUN, but only if `organizerId` owns it (or the role is elevated).
 * Returns null for both "no such mun" and "not yours" — the caller renders the
 * same 404 either way, so a probing request can't distinguish a real id it
 * doesn't own from a fabricated one.
 */
export const getWorkspaceMun = cache(
  async (
    munId: string,
    organizerId: string,
    role: Role,
  ): Promise<WorkspaceMun | null> => {
    // A malformed uuid would make Postgres throw rather than return zero rows,
    // which surfaces as a 500 on a route a user can type by hand.
    if (!UUID_PATTERN.test(munId)) return null;

    const [mun] = await db
      .select({
        id: muns.id,
        name: muns.name,
        slug: muns.slug,
        edition: muns.edition,
        status: muns.status,
        organizerId: muns.organizerId,
      })
      .from(muns)
      .where(eq(muns.id, munId))
      .limit(1);

    if (!mun) return null;
    if (!ELEVATED_ROLES.includes(role) && mun.organizerId !== organizerId) {
      return null;
    }

    return {
      id: mun.id,
      name: mun.name,
      slug: mun.slug,
      edition: mun.edition,
      status: mun.status,
    };
  },
);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
