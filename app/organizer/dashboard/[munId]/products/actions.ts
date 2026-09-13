"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import {
  createRegistrationProduct,
  deleteRegistrationProduct,
  updateRegistrationProduct,
} from "@/lib/actions/mun-config";

/**
 * Route-local wrappers around the frozen `lib/actions/mun-config` registration
 * product surface. Same three-part contract as
 * `app/admin/review/actions.ts` and the committees module beside this one:
 *
 *   1. The lib actions THROW (`Forbidden`, `Mun not found`, `Registration
 *      product not found`, plus raw Postgres errors on a constraint
 *      violation). A client component needs a discriminated result it can turn
 *      into a toast, not an unhandled server-action rejection that blanks the
 *      page with an error boundary.
 *   2. Every lib action takes `session: Session | null` explicitly — it does
 *      NOT read the cookie itself. `await getSession()` here is the only place
 *      the actor is resolved, and it is resolved SERVER-SIDE. No caller can
 *      supply an identity.
 *   3. The workspace renders dynamically off the session cookie, so a mutation
 *      needs `revalidatePath` or the product list lingers in the client router
 *      cache and the UI shows a stale row the DB no longer has.
 *
 * Authorization is deliberately NOT re-implemented here.
 * `createRegistrationProduct` / `updateRegistrationProduct` /
 * `deleteRegistrationProduct` each call `assertOwnsOrAdmin` internally
 * (resolving product -> munId first on update/delete), so the munId/productId
 * arriving from the client is checked against the session's ownership before
 * any write. A second check here would be a stale duplicate, and would imply
 * the lib layer could be called unguarded.
 *
 * `revalidateSection` takes the munId only to build the path. It cannot leak
 * another organizer's data: the mutation preceding it has already thrown if
 * the actor doesn't own that mun.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: never } : { data: T }))
  | { ok: false; error: string };

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Forbidden") {
      return "You no longer have permission to edit this conference. Sign in again.";
    }
    if (error.message === "Mun not found") {
      return "This conference no longer exists. Reload the page.";
    }
    if (error.message === "Registration product not found") {
      return "That product was already removed. Reload the page.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

function revalidateSection(munId: string): void {
  revalidatePath(`/organizer/dashboard/${munId}/products`);
}

/** Everything the create/edit dialog collects, pre-coercion. */
export interface ProductFormValues {
  name: string;
  /** Whole major units (rupees), not paise — matches `registrationProducts.price`. */
  price: number;
  capacity: number;
  currency: string;
  /** `yyyy-MM-dd` from a native date input, or `""` for no deadline. */
  deadline: string;
}

/**
 * A `<input type="date">` yields `yyyy-MM-dd` with no time or zone. `new
 * Date("2026-03-01")` parses that as UTC midnight, which in any negative-offset
 * zone renders as the PREVIOUS day — the classic off-by-one that makes a
 * deadline look a day early. Constructing from parts pins it to local midnight,
 * and then to end-of-day: a deadline of "1 March" means registration closes as
 * March 1st ends, not as it begins.
 */
function parseDeadline(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return undefined;

  const [, year, month, day] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    23,
    59,
    59,
    999,
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Boundary validation. The lib layer trusts its input shape (it is typed, not
 * parsed), and Postgres would accept a negative price or a zero capacity
 * happily — both of which are nonsense that would surface later as an
 * unsellable product or a free pass. Reject here, once, with a message the
 * dialog can show.
 */
function validate(values: ProductFormValues): string | null {
  if (!values.name.trim()) return "Give the product a name.";
  if (values.name.trim().length > 120) {
    return "Product name is too long (120 characters max).";
  }
  if (!Number.isInteger(values.price) || values.price < 0) {
    return "Price must be a whole number of rupees, zero or more.";
  }
  if (values.price > 10_000_000) {
    return "Price looks wrong — cap is ₹1,00,00,000.";
  }
  if (!Number.isInteger(values.capacity) || values.capacity < 1) {
    return "Capacity must be at least 1 seat.";
  }
  if (values.capacity > 100_000) {
    return "Capacity looks wrong — cap is 100,000 seats.";
  }
  if (!/^[A-Z]{3}$/.test(values.currency)) {
    return "Currency must be a 3-letter code, e.g. INR.";
  }
  return null;
}

export async function createProductAction(
  munId: string,
  values: ProductFormValues,
): Promise<ActionResult<{ id: string; name: string }>> {
  const invalid = validate(values);
  if (invalid) return { ok: false, error: invalid };

  try {
    const session = await getSession();
    const product = await createRegistrationProduct(
      {
        munId,
        name: values.name.trim(),
        price: values.price,
        capacity: values.capacity,
        currency: values.currency,
        deadline: parseDeadline(values.deadline),
      },
      session,
    );
    revalidateSection(munId);
    return { ok: true, data: { id: product.id, name: product.name } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function updateProductAction(
  munId: string,
  productId: string,
  values: ProductFormValues,
): Promise<ActionResult<{ id: string; name: string }>> {
  const invalid = validate(values);
  if (invalid) return { ok: false, error: invalid };

  try {
    const session = await getSession();
    // `deadline` is the one field that can be CLEARED on an edit. Drizzle's
    // `.set()` skips `undefined` keys, so passing `undefined` for an emptied
    // date input would silently keep the old deadline. `UpdateRegistrationProductInput`
    // types `deadline` as `Date | undefined`, so a real null needs the cast —
    // the column IS nullable (`timestamp('deadline')`, no `.notNull()`), the
    // input type just doesn't model the clear case.
    const deadline = parseDeadline(values.deadline);

    const product = await updateRegistrationProduct(
      productId,
      {
        name: values.name.trim(),
        price: values.price,
        capacity: values.capacity,
        currency: values.currency,
        deadline: deadline ?? (null as unknown as undefined),
      },
      session,
    );
    revalidateSection(munId);
    return { ok: true, data: { id: product.id, name: product.name } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

/**
 * ARCHIVE, not a destructive delete — `deleteRegistrationProduct` flips
 * `status` to `'inactive'` rather than removing the row, because
 * `registrations.registrationProductId` is a NOT NULL FK carrying payment
 * history. The UI must say "archive", not "delete", or the organizer will
 * expect the row to disappear and be confused when it stays (greyed out).
 */
export async function archiveProductAction(
  munId: string,
  productId: string,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    await deleteRegistrationProduct(productId, session);
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

/**
 * Un-archive. There is no dedicated lib action for this, but
 * `updateRegistrationProduct` accepts `status`, so restoring is just the
 * inverse write through the same guarded path. Without this an accidental
 * archive would be irreversible from the UI, which is a bad property for a
 * one-click destructive-looking button.
 */
export async function restoreProductAction(
  munId: string,
  productId: string,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    await updateRegistrationProduct(productId, { status: "active" }, session);
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}
