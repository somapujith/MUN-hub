import "server-only";

import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { muns, registrationProducts, registrations } from "@/lib/db/schema";
import type { Role } from "@/lib/db/schema-enums";

/**
 * Read side for the Registration Products module.
 *
 * WHY THIS FILE EXISTS (read before "just use the lib action"):
 *
 * `lib/actions/mun-config.ts` ships `listCommittees` and `listPortfolios` but
 * has NO `listRegistrationProducts`. That is a real gap in the frozen contract,
 * not an oversight on the caller's part — the three product mutations
 * (`createRegistrationProduct` / `updateRegistrationProduct` /
 * `deleteRegistrationProduct`) exist and are complete, but nothing in `lib/`
 * can enumerate a mun's products for its own organizer.
 *
 * The two candidates and why neither works:
 *
 *   1. `getMunBySlug` (`lib/actions/marketplace.ts`) does return
 *      `registrationProducts` on `MunDetail`, but it filters
 *      `eq(registrationProducts.status, 'active')`. `deleteRegistrationProduct`
 *      is a SOFT delete that flips `status` to `'inactive'`. So the marketplace
 *      read is structurally incapable of showing a soft-deleted product — an
 *      organizer would delete a row and it would vanish with no way to see or
 *      restore it, and the page could never distinguish "archived" from "never
 *      existed". It also gates on the mun being publicly visible, which a DRAFT
 *      mun is not.
 *   2. `getMunOverview` (`lib/actions/organizer-dashboard.ts`) only sums
 *      capacity into an aggregate; it never returns product rows.
 *
 * Per the module brief this file does NOT add a list function under `lib/`.
 * It is a page-local Drizzle read, and the gap is reported upward.
 *
 * IDOR: `getProductsForMun` takes the munId from the URL, so it re-checks
 * ownership itself against a session-derived `organizerId` rather than
 * trusting that `[munId]/layout.tsx` already did. The layout is chrome, not a
 * security boundary (it does not re-run on client-side navigation between
 * sibling sections), which is the same reasoning `lib/actions/mun-config.ts`
 * gives for calling `assertOwnsOrAdmin` on every mutation. Returns null for
 * both "no such mun" and "not yours" so a probe can't tell them apart.
 */

/** Roles that may read any organizer's products, mirroring `workspace-queries.ts`. */
const ELEVATED_ROLES: readonly Role[] = ["ADMIN", "SUPER_ADMIN"];

/**
 * Registration statuses that consume a seat.
 *
 * Mirrors `ACTIVE_REGISTRATION_STATUSES` in `lib/actions/registration.ts`,
 * which is module-private there. PAYMENT_PENDING counts because
 * `initiateRegistration` reserves the seat at order time — an organizer
 * planning capacity needs to see held seats, not just settled ones, or the
 * dashboard would under-report and they'd oversell against their own numbers.
 */
const SEAT_CONSUMING_STATUSES = [
  "PAYMENT_PENDING",
  "CONFIRMED",
  "ATTENDED",
] as const;

export interface ProductRow {
  id: string;
  name: string;
  price: number;
  currency: string;
  capacity: number;
  deadline: Date | null;
  status: string;
  createdAt: Date;
  /** Seats consumed by pending/confirmed/attended registrations. */
  taken: number;
  /** `capacity - taken`, floored at zero. */
  available: number;
}

export interface ProductsPageData {
  products: ProductRow[];
  totals: {
    /** Summed capacity across ACTIVE products only — archived rows don't sell. */
    capacity: number;
    taken: number;
    available: number;
    activeCount: number;
    archivedCount: number;
  };
}

export async function getProductsForMun(
  munId: string,
  organizerId: string,
  role: Role,
): Promise<ProductsPageData | null> {
  // A malformed uuid makes Postgres throw rather than return zero rows, which
  // surfaces as a 500 on a route a user can type by hand.
  if (!UUID_PATTERN.test(munId)) return null;

  const [mun] = await db
    .select({ organizerId: muns.organizerId })
    .from(muns)
    .where(eq(muns.id, munId))
    .limit(1);

  if (!mun) return null;
  if (!ELEVATED_ROLES.includes(role) && mun.organizerId !== organizerId) {
    return null;
  }

  const rows = await db
    .select()
    .from(registrationProducts)
    .where(eq(registrationProducts.munId, munId))
    .orderBy(asc(registrationProducts.price), asc(registrationProducts.createdAt));

  if (rows.length === 0) {
    return {
      products: [],
      totals: {
        capacity: 0,
        taken: 0,
        available: 0,
        activeCount: 0,
        archivedCount: 0,
      },
    };
  }

  // One grouped aggregate instead of an N-query `getProductAvailability` fan-out.
  //
  // `getProductAvailability` in `lib/actions/registration.ts` is the canonical
  // per-product read and IS reusable (it takes a bare productId), but it opens
  // with `releaseExpiredReservations` — a WRITE — and then runs two more
  // queries. Calling it once per product would turn a list render into 3N round
  // trips plus N writes on every page view. This computes the same
  // capacity/taken/available triple over the same status set in one pass. The
  // only divergence is expired-reservation sweeping, which the registration
  // funnel itself performs at the moment it matters (before taking a seat).
  const takenRows = await db
    .select({
      productId: registrations.registrationProductId,
      taken: count(),
    })
    .from(registrations)
    .where(
      and(
        inArray(
          registrations.registrationProductId,
          rows.map((row) => row.id),
        ),
        inArray(registrations.status, [...SEAT_CONSUMING_STATUSES]),
      ),
    )
    .groupBy(registrations.registrationProductId);

  const takenByProduct = new Map<string, number>(
    takenRows.map((row) => [row.productId, row.taken]),
  );

  const products: ProductRow[] = rows.map((row) => {
    const taken = takenByProduct.get(row.id) ?? 0;
    return {
      id: row.id,
      name: row.name,
      price: row.price,
      currency: row.currency,
      capacity: row.capacity,
      deadline: row.deadline,
      status: row.status,
      createdAt: row.createdAt,
      taken,
      available: Math.max(row.capacity - taken, 0),
    };
  });

  const active = products.filter((product) => product.status === "active");

  return {
    products,
    totals: {
      capacity: active.reduce((sum, product) => sum + product.capacity, 0),
      taken: active.reduce((sum, product) => sum + product.taken, 0),
      available: active.reduce((sum, product) => sum + product.available, 0),
      activeCount: active.length,
      archivedCount: products.length - active.length,
    },
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
