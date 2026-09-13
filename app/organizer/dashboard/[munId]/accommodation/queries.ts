import "server-only";

import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  accommodationOptionFields,
  accommodationOptions,
  muns,
  registrations,
} from "@/lib/db/schema";
import type {
  AccommodationFieldType,
  Role,
} from "@/lib/db/schema-enums";

/**
 * Read side for the Accommodation module.
 *
 * WHY THIS FILE EXISTS (read before "just call listAccommodationOptions").
 *
 * `lib/actions/accommodation.ts` DOES ship both list functions, unlike the
 * registration-products module next door (whose `queries.ts` exists because no
 * list action existed at all). The reason this file still exists is different
 * and more important: both list functions are documented "Public read, no
 * auth", and they mean it —
 *
 *   listAccommodationOptions(munId)      -> no session parameter at all
 *   listAccommodationOptionFields(id)    -> no session parameter at all
 *
 * They take the id straight off the URL and return rows. That is correct for
 * their intended caller (the public registration funnel's accommodation step,
 * where the data is public by definition), but it means that if this dashboard
 * page called them directly, `/organizer/dashboard/<any-mun-uuid>/accommodation`
 * would render ANY organizer's accommodation inventory — pricing, capacity,
 * and their internal custom-field definitions — to any signed-in organizer who
 * pasted a uuid. A textbook IDOR.
 *
 * So the ownership check happens HERE, exactly as `products/queries.ts` does
 * it, and for the same stated reason: `[munId]/layout.tsx` is chrome, not a
 * security boundary (it does not re-run on client-side navigation between
 * sibling sections). Returns `null` for both "no such mun" and "not yours" so a
 * probe cannot tell the two apart.
 *
 * Mutations are NOT affected by this — every create/update/delete in
 * `lib/actions/accommodation.ts` calls `assertOwnsOrAdmin` internally. It is
 * only the two public reads that need a caller-side gate.
 *
 * Given the ownership gate has to run here anyway, the rows are then read with
 * Drizzle directly in one pass rather than calling the lib list functions
 * per-option: rendering N options via `listAccommodationOptionFields` would be
 * N round trips for what is one `inArray` query.
 */

/** Roles that may read any organizer's accommodation, mirroring `products/queries.ts`. */
const ELEVATED_ROLES: readonly Role[] = ["ADMIN", "SUPER_ADMIN"];

/**
 * Registration statuses that consume an accommodation bed.
 *
 * Identical set to `SEAT_CONSUMING_STATUSES` in `products/queries.ts`, and for
 * the identical reason: `initiateRegistration` reserves at order time, so
 * PAYMENT_PENDING is holding a bed even though no money has settled. An
 * organizer allocating rooms needs held beds counted or they will double-book
 * against their own dashboard.
 */
const BED_CONSUMING_STATUSES = [
  "PAYMENT_PENDING",
  "CONFIRMED",
  "ATTENDED",
] as const;

/**
 * One custom field on an accommodation option.
 *
 * `choices` is `jsonb` in the schema and therefore typed `unknown` on
 * `AccommodationOptionField` in the frozen contract. It is normalised to
 * `string[]` exactly once — here — so no client component has to defensively
 * re-narrow an `unknown` on every render. A row whose jsonb is null (TEXT /
 * NUMBER / DATE) or malformed becomes `[]`, never `undefined`, so callers can
 * always `.map()` it.
 */
export interface FieldRow {
  id: string;
  optionId: string;
  fieldType: AccommodationFieldType;
  label: string;
  required: boolean;
  choices: string[];
  displayOrder: number;
}

export interface AccommodationOptionRow {
  id: string;
  name: string;
  price: number;
  capacity: number;
  description: string | null;
  status: string;
  createdAt: Date;
  /** Beds consumed by pending/confirmed/attended registrations. */
  taken: number;
  /** `capacity - taken`, floored at zero. */
  available: number;
  /** Custom fields for this option, already ordered by `displayOrder`. */
  fields: FieldRow[];
}

export interface AccommodationPageData {
  options: AccommodationOptionRow[];
  totals: {
    /** Summed capacity across ACTIVE options only — archived rows aren't sold. */
    capacity: number;
    taken: number;
    available: number;
    activeCount: number;
    archivedCount: number;
  };
}

/**
 * `choices` arrives as whatever was written into a `jsonb` column. Postgres
 * will happily hand back a string, a number, an object — anything previously
 * serialised there. Only an array of strings is meaningful as a choice list, so
 * everything else collapses to empty rather than reaching a `.map()` in the
 * render tree.
 */
function toChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function getAccommodationForMun(
  munId: string,
  organizerId: string,
  role: Role,
): Promise<AccommodationPageData | null> {
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
    .from(accommodationOptions)
    .where(eq(accommodationOptions.munId, munId))
    .orderBy(asc(accommodationOptions.price), asc(accommodationOptions.createdAt));

  if (rows.length === 0) {
    return {
      options: [],
      totals: {
        capacity: 0,
        taken: 0,
        available: 0,
        activeCount: 0,
        archivedCount: 0,
      },
    };
  }

  const optionIds = rows.map((row) => row.id);

  // Two grouped/batched queries for the whole page instead of 2N.
  const [takenRows, fieldRows] = await Promise.all([
    db
      .select({
        optionId: registrations.accommodationOptionId,
        taken: count(),
      })
      .from(registrations)
      .where(
        and(
          inArray(registrations.accommodationOptionId, optionIds),
          inArray(registrations.status, [...BED_CONSUMING_STATUSES]),
        ),
      )
      .groupBy(registrations.accommodationOptionId),
    db
      .select()
      .from(accommodationOptionFields)
      .where(inArray(accommodationOptionFields.optionId, optionIds))
      .orderBy(
        asc(accommodationOptionFields.displayOrder),
        asc(accommodationOptionFields.createdAt),
      ),
  ]);

  // `registrations.accommodationOptionId` is NULLABLE (accommodation is
  // optional), so its select type is `string | null` even though the
  // `inArray` filter guarantees non-null here. Narrowed rather than asserted.
  const takenByOption = new Map<string, number>();
  for (const row of takenRows) {
    if (row.optionId !== null) takenByOption.set(row.optionId, row.taken);
  }

  const fieldsByOption = new Map<string, FieldRow[]>();
  for (const row of fieldRows) {
    const list = fieldsByOption.get(row.optionId) ?? [];
    list.push({
      id: row.id,
      optionId: row.optionId,
      fieldType: row.fieldType,
      label: row.label,
      required: row.required,
      choices: toChoices(row.choices),
      displayOrder: row.displayOrder,
    });
    fieldsByOption.set(row.optionId, list);
  }

  const options: AccommodationOptionRow[] = rows.map((row) => {
    const taken = takenByOption.get(row.id) ?? 0;
    return {
      id: row.id,
      name: row.name,
      price: row.price,
      capacity: row.capacity,
      description: row.description,
      status: row.status,
      createdAt: row.createdAt,
      taken,
      available: Math.max(row.capacity - taken, 0),
      fields: fieldsByOption.get(row.id) ?? [],
    };
  });

  const active = options.filter((option) => option.status === "active");

  return {
    options,
    totals: {
      capacity: active.reduce((sum, option) => sum + option.capacity, 0),
      taken: active.reduce((sum, option) => sum + option.taken, 0),
      available: active.reduce((sum, option) => sum + option.available, 0),
      activeCount: active.length,
      archivedCount: options.length - active.length,
    },
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
