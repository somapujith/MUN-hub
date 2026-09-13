import "server-only";

import { cache } from "react";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  committees,
  muns,
  organizerApplications,
  registrationProducts,
  registrations,
} from "@/lib/db/schema";
import type { MunStatus, RegistrationStatus } from "@/lib/db/schema-enums";

/**
 * Organizer-wide reads for the two `(workspace)` routes: Overview
 * (`/organizer/dashboard`) and My MUNs (`/organizer/dashboard/muns`).
 *
 * WHY THIS ISN'T IN `lib/actions/*`
 * ---------------------------------
 * `lib/actions/organizer-dashboard.ts` is a frozen contract surface and is
 * keyed per-mun: `getMunOverview(munId)` answers "how is THIS conference
 * doing". Both screens here are organizer-wide, and calling `getMunOverview`
 * once per owned mun would be N round trips plus N ownership re-checks for
 * data we already know is ours (the layout resolved the actor). Everything
 * below is a grouped aggregate over the owned-mun id set instead — a fixed
 * number of queries regardless of how many conferences the organizer runs.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 * PRD § 6 also lists GMV, platform fees, refunds and registration conversion;
 * PRD § 7 lists per-card GMV. None of them are computed here. There is no
 * payment-aggregation backend on the organizer-wide axis, and conversion needs
 * a page-view denominator that nothing in this system records. A plausible
 * number in a money field is worse than an absent one — an organizer will
 * reconcile against it. They land when the finance module does.
 *
 * IDOR: every function takes `organizerId` from a server-side `getSession()`
 * (via `requireOrganizerActor()`) in the page, never from a search param or a
 * request body, and constrains every aggregate to `muns.organizerId`. No mun
 * id from the client is accepted anywhere in this file.
 */

/**
 * Registration statuses that consume a seat. Mirrors `getMunOverview`'s
 * `COUNTABLE_REGISTRATION_STATUSES` exactly — if the two ever drift, the
 * per-mun Overview and this organizer-wide one will disagree about the same
 * conference, which reads as a bug in the product rather than in the code.
 */
const CONFIRMED_STATUSES = ["CONFIRMED", "ATTENDED"] as const;

/**
 * Statuses where a seat is reserved but not yet paid for. These count against
 * neither "confirmed" nor available capacity permanently — a PAYMENT_PENDING
 * row expires on its TTL — but the organizer needs to see them, because they
 * are the seats currently in flight.
 */
const PENDING_STATUSES = ["PENDING", "PAYMENT_PENDING"] as const;

/** Statuses where a MUN is publicly visible / actively selling. */
const LIVE_STATUSES: readonly MunStatus[] = [
  "PUBLISHED",
  "REGISTRATION_OPEN",
  "CONFERENCE_ACTIVE",
];

/**
 * Statuses whose public `/mun/[slug]` page actually resolves.
 *
 * Must stay identical to `PUBLIC_DETAIL_STATUSES` in
 * `lib/actions/marketplace.ts` — that list is what `getMunBySlug` gates on, so
 * any status here that isn't there turns "View live page" into a 404, and any
 * status there but not here hides a link that would have worked.
 */
const PUBLIC_STATUSES: readonly MunStatus[] = [
  "PUBLISHED",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "CONFERENCE_ACTIVE",
  "COMPLETED",
  "ARCHIVED",
];

export function hasPublicPage(status: MunStatus): boolean {
  return PUBLIC_STATUSES.includes(status);
}

export interface OrganizerMunSummary {
  id: string;
  name: string;
  slug: string;
  edition: string | null;
  city: string | null;
  country: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: MunStatus;
  /** CONFIRMED + ATTENDED — seats actually taken. */
  confirmed: number;
  /** PENDING + PAYMENT_PENDING — seats reserved, money not in. */
  pending: number;
  /** Summed capacity of *active* registration products; null if none exist. */
  capacity: number | null;
  /**
   * Earliest deadline across active registration products, or null when no
   * product carries one. The seed sets none, so "not set" is the common case
   * and every consumer has to render it — do not assume a date.
   */
  registrationDeadline: Date | null;
}

export interface OrganizerWorkspaceData {
  muns: OrganizerMunSummary[];
  totals: {
    munCount: number;
    liveCount: number;
    /** Confirmed + pending, i.e. every non-cancelled registration. */
    totalRegistrations: number;
    confirmed: number;
    pending: number;
    /** Summed active-product capacity across every owned mun. */
    capacity: number;
    /** capacity - confirmed, floored at 0. Null when no product configured. */
    availableSeats: number | null;
  };
  /** Confirmed-registration counts by how recently they came in. */
  recent: { today: number; week: number; month: number };
  /** The organizer's single application row, if they've submitted one. */
  application: {
    status: string;
    submittedAt: Date;
    munId: string | null;
  } | null;
}

/**
 * Everything both `(workspace)` screens need, in six grouped queries.
 *
 * `cache()`d because Overview renders the totals and My MUNs renders the rows
 * from the same shape — and `generateMetadata` may read it too.
 */
export const getOrganizerWorkspaceData = cache(
  async (organizerId: string): Promise<OrganizerWorkspaceData> => {
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
        totals: {
          munCount: 0,
          liveCount: 0,
          totalRegistrations: 0,
          confirmed: 0,
          pending: 0,
          capacity: 0,
          availableSeats: null,
        },
        recent: { today: 0, week: 0, month: 0 },
        application: application ?? null,
      };
    }

    const munIds = ownedMuns.map((mun) => mun.id);
    const now = new Date();

    const [statusCounts, products, recent] = await Promise.all([
      db
        .select({
          munId: registrations.munId,
          status: registrations.status,
          total: count(),
        })
        .from(registrations)
        .where(
          and(
            inArray(registrations.munId, munIds),
            inArray(registrations.status, [
              ...CONFIRMED_STATUSES,
              ...PENDING_STATUSES,
            ]),
          ),
        )
        .groupBy(registrations.munId, registrations.status),
      db
        .select({
          munId: registrationProducts.munId,
          capacity: registrationProducts.capacity,
          deadline: registrationProducts.deadline,
          status: registrationProducts.status,
        })
        .from(registrationProducts)
        .where(inArray(registrationProducts.munId, munIds)),
      countRecentRegistrations(munIds, now),
    ]);

    const confirmedByMun = new Map<string, number>();
    const pendingByMun = new Map<string, number>();
    for (const row of statusCounts) {
      const bucket = isConfirmed(row.status) ? confirmedByMun : pendingByMun;
      bucket.set(row.munId, (bucket.get(row.munId) ?? 0) + row.total);
    }

    const capacityByMun = new Map<string, number>();
    const deadlineByMun = new Map<string, Date>();
    for (const product of products) {
      // An inactive product isn't selling, so its seats aren't available and
      // its deadline isn't a deadline. Same rule the marketplace applies.
      if (product.status !== "active") continue;
      capacityByMun.set(
        product.munId,
        (capacityByMun.get(product.munId) ?? 0) + product.capacity,
      );
      if (!product.deadline) continue;
      const current = deadlineByMun.get(product.munId);
      // Earliest wins: the first product to close is the first thing the
      // organizer has to act on.
      if (!current || product.deadline < current) {
        deadlineByMun.set(product.munId, product.deadline);
      }
    }

    const rows: OrganizerMunSummary[] = ownedMuns.map((mun) => ({
      ...mun,
      confirmed: confirmedByMun.get(mun.id) ?? 0,
      pending: pendingByMun.get(mun.id) ?? 0,
      capacity: capacityByMun.get(mun.id) ?? null,
      registrationDeadline: deadlineByMun.get(mun.id) ?? null,
    }));

    const confirmed = sumBy(rows, (row) => row.confirmed);
    const pending = sumBy(rows, (row) => row.pending);
    const capacity = sumBy(rows, (row) => row.capacity ?? 0);
    const hasCapacity = rows.some((row) => row.capacity !== null);

    return {
      muns: rows,
      totals: {
        munCount: rows.length,
        liveCount: rows.filter((row) => LIVE_STATUSES.includes(row.status))
          .length,
        totalRegistrations: confirmed + pending,
        confirmed,
        pending,
        capacity,
        availableSeats: hasCapacity ? Math.max(capacity - confirmed, 0) : null,
      },
      recent,
      application: application ?? null,
    };
  },
);

function isConfirmed(status: RegistrationStatus): boolean {
  return (CONFIRMED_STATUSES as readonly RegistrationStatus[]).includes(status);
}

function sumBy<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/**
 * Confirmed registrations in the last day / 7 days / 30 days, as one query
 * with three conditional counts rather than three round trips.
 *
 * Windows are rolling (`now - 24h`), not calendar-aligned. A calendar "today"
 * would need the organizer's timezone, which the session doesn't carry, and a
 * server-local midnight would silently mean a different thing for an organizer
 * in another country. Rolling windows are correct everywhere, so the labels
 * say "last 24 hours", not "today".
 */
async function countRecentRegistrations(
  munIds: readonly string[],
  now: Date,
): Promise<{ today: number; week: number; month: number }> {
  const since = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const [row] = await db
    .select({
      today: countIf(gte(registrations.createdAt, since(1))),
      week: countIf(gte(registrations.createdAt, since(7))),
      month: countIf(gte(registrations.createdAt, since(30))),
    })
    .from(registrations)
    .where(
      and(
        inArray(registrations.munId, [...munIds]),
        inArray(registrations.status, [...CONFIRMED_STATUSES]),
      ),
    );

  return {
    today: Number(row?.today ?? 0),
    week: Number(row?.week ?? 0),
    month: Number(row?.month ?? 0),
  };
}

/** `count(*) filter (where ...)` — one scan, several buckets. */
function countIf(condition: ReturnType<typeof gte>) {
  return sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
}

// ---------------------------------------------------------------------------
// Action Center (PRD § 6)
// ---------------------------------------------------------------------------

/**
 * PRD § 6 lists seven alert kinds. Only two are derivable from data that
 * actually exists today, so only two are implemented:
 *
 *   committee-full     committees.capacity vs confirmed registrations — real
 *   deadline-soon      registrationProducts.deadline vs now — real
 *
 * Not implemented, and why: "failed/pending payments" needs the payments
 * aggregate this file deliberately doesn't own; "MUNHub change requests" has
 * no organizer-facing request table; "new registrations" duplicates the
 * recency stats above; "certificate completion" and "results awaiting
 * verification" have no backing module. An Action Center that invents its own
 * alerts trains organizers to ignore it.
 */

export type WorkspaceAlertKind = "committee-full" | "deadline-soon";

export interface WorkspaceAlert {
  id: string;
  kind: WorkspaceAlertKind;
  munId: string;
  munName: string;
  /** What happened, in one line. Rendered as the alert's own text. */
  title: string;
  detail: string;
  /** Section to open to act on it. */
  href: string;
  /** Higher first. Full committees outrank approaching deadlines. */
  weight: number;
}

/** A committee at or above this fill ratio is "nearly full". */
const COMMITTEE_FULL_RATIO = 0.9;
/** A deadline inside this many days is "approaching". */
const DEADLINE_SOON_DAYS = 14;

/**
 * Alerts across every mun the organizer owns, most urgent first.
 *
 * Takes the already-fetched summaries so it doesn't re-query the mun list, and
 * so it physically cannot widen the id set beyond what the ownership-filtered
 * read returned.
 */
export async function getWorkspaceAlerts(
  munSummaries: readonly OrganizerMunSummary[],
  now: Date = new Date(),
): Promise<WorkspaceAlert[]> {
  if (munSummaries.length === 0) return [];

  const alerts: WorkspaceAlert[] = [];
  const byId = new Map(munSummaries.map((mun) => [mun.id, mun]));

  // --- deadline-soon: derived from data we already have in hand. ------------
  const soonest = new Date(
    now.getTime() + DEADLINE_SOON_DAYS * 24 * 60 * 60 * 1000,
  );
  for (const mun of munSummaries) {
    const deadline = mun.registrationDeadline;
    if (!deadline || deadline < now || deadline > soonest) continue;
    const days = Math.ceil(
      (deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );
    alerts.push({
      id: `deadline-${mun.id}`,
      kind: "deadline-soon",
      munId: mun.id,
      munName: mun.name,
      title: `Registration closes in ${days} ${days === 1 ? "day" : "days"}`,
      detail: `${mun.name} stops accepting registrations on ${formatAlertDate(deadline)}.`,
      href: `/organizer/dashboard/${mun.id}/products`,
      weight: 100 - days,
    });
  }

  // --- committee-full: one grouped query over the owned muns' committees. ---
  const fill = await db
    .select({
      committeeId: committees.id,
      committeeName: committees.name,
      munId: committees.munId,
      capacity: committees.capacity,
      taken: sql<number>`count(${registrations.id})`.mapWith(Number),
    })
    .from(committees)
    .leftJoin(
      registrations,
      and(
        eq(registrations.committeeId, committees.id),
        inArray(registrations.status, [...CONFIRMED_STATUSES]),
      ),
    )
    .where(
      and(
        inArray(committees.munId, [...byId.keys()]),
        // capacity 0 means "not configured yet", not "full" — a 0/0 committee
        // would otherwise alert on every single render.
        sql`${committees.capacity} > 0`,
      ),
    )
    .groupBy(committees.id, committees.name, committees.munId, committees.capacity);

  for (const row of fill) {
    const ratio = row.taken / row.capacity;
    if (ratio < COMMITTEE_FULL_RATIO) continue;
    const mun = byId.get(row.munId);
    if (!mun) continue;
    const full = row.taken >= row.capacity;
    alerts.push({
      id: `committee-${row.committeeId}`,
      kind: "committee-full",
      munId: row.munId,
      munName: mun.name,
      title: full
        ? `${row.committeeName} is full`
        : `${row.committeeName} is nearly full`,
      detail: `${row.taken} of ${row.capacity} seats taken in ${mun.name}. ${
        full
          ? "Raise the cap or close the committee."
          : "Consider raising the cap before it closes itself."
      }`,
      href: `/organizer/dashboard/${row.munId}/committees`,
      weight: full ? 200 : 150,
    });
  }

  return alerts.sort((a, b) => b.weight - a.weight);
}

function formatAlertDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Whole days from now until `date`. Negative when the date has passed.
 * Exported so the two screens count down identically.
 */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}
