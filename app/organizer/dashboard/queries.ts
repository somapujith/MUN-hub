import "server-only";

import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  muns,
  organizerApplications,
  registrationProducts,
  registrations,
} from "@/lib/db/schema";
import type { MunStatus } from "@/lib/db/schema-enums";

/**
 * Read-side queries for the organizer dashboard.
 *
 * These live here rather than in `lib/actions/organizer-dashboard.ts` because
 * that module is a frozen contract surface owned by the backend session and
 * exposes only per-mun aggregates (`getMunOverview`, `getDelegateList`) — it
 * has no "list the muns this organizer owns" entry point, which this page
 * needs before it can call either of those.
 *
 * IDOR: every function here takes `organizerId` from a server-side
 * `getSession()` in the page, never from a search param or request body, and
 * filters `muns.organizerId` on it. Nothing here accepts a mun id from the
 * client.
 */

/** Registration statuses that consume a seat — mirrors `getMunOverview`. */
const COUNTABLE_REGISTRATION_STATUSES = ["CONFIRMED", "ATTENDED"] as const;

export interface OrganizerMunRow {
  id: string;
  name: string;
  slug: string;
  edition: string | null;
  city: string | null;
  country: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: MunStatus;
  /** Confirmed + attended registrations across all of this mun's products. */
  registrationCount: number;
  /** Summed capacity of active registration products, or null if none configured. */
  capacity: number | null;
}

export interface OrganizerDashboardData {
  muns: OrganizerMunRow[];
  totals: {
    munCount: number;
    registrationCount: number;
    liveCount: number;
  };
  /** The organizer's single application row, if they've submitted one. */
  application: {
    status: string;
    submittedAt: Date;
    munId: string | null;
  } | null;
}

/** Statuses where a MUN is publicly visible / actively selling. */
const LIVE_STATUSES: readonly MunStatus[] = [
  "PUBLISHED",
  "REGISTRATION_OPEN",
  "CONFERENCE_ACTIVE",
];

export async function getOrganizerDashboard(
  organizerId: string,
): Promise<OrganizerDashboardData> {
  const ownedMuns = await db
    .select({
      id: muns.id,
      name: muns.name,
      slug: muns.slug,
      edition: muns.edition,
      city: muns.city,
      country: muns.country,
      startDate: muns.startDate,
      endDate: muns.endDate,
      status: muns.status,
    })
    .from(muns)
    .where(eq(muns.organizerId, organizerId))
    .orderBy(desc(muns.createdAt));

  const [application] = await db
    .select({
      status: organizerApplications.status,
      submittedAt: organizerApplications.submittedAt,
      munId: organizerApplications.munId,
    })
    .from(organizerApplications)
    .where(eq(organizerApplications.organizerId, organizerId))
    .limit(1);

  if (ownedMuns.length === 0) {
    return {
      muns: [],
      totals: { munCount: 0, registrationCount: 0, liveCount: 0 },
      application: application ?? null,
    };
  }

  const munIds = ownedMuns.map((mun) => mun.id);

  // Two grouped aggregates instead of 2N per-mun round trips.
  const [counts, capacities] = await Promise.all([
    db
      .select({ munId: registrations.munId, count: count() })
      .from(registrations)
      .where(
        and(
          inArray(registrations.munId, munIds),
          inArray(registrations.status, [...COUNTABLE_REGISTRATION_STATUSES]),
        ),
      )
      .groupBy(registrations.munId),
    db
      .select({
        munId: registrationProducts.munId,
        capacity: registrationProducts.capacity,
        status: registrationProducts.status,
      })
      .from(registrationProducts)
      .where(inArray(registrationProducts.munId, munIds)),
  ]);

  const countByMun = new Map<string, number>(
    counts.map((row) => [row.munId, row.count]),
  );

  const capacityByMun = new Map<string, number>();
  for (const product of capacities) {
    if (product.status === "inactive") continue;
    capacityByMun.set(
      product.munId,
      (capacityByMun.get(product.munId) ?? 0) + product.capacity,
    );
  }

  const rows: OrganizerMunRow[] = ownedMuns.map((mun) => ({
    ...mun,
    registrationCount: countByMun.get(mun.id) ?? 0,
    capacity: capacityByMun.get(mun.id) ?? null,
  }));

  return {
    muns: rows,
    totals: {
      munCount: rows.length,
      registrationCount: rows.reduce((sum, row) => sum + row.registrationCount, 0),
      liveCount: rows.filter((row) => LIVE_STATUSES.includes(row.status)).length,
    },
    application: application ?? null,
  };
}
