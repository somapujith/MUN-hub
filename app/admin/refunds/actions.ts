"use server";

import { revalidatePath } from "next/cache";
import { approveRefund, rejectRefund } from "@/lib/lifecycle/refund";

/**
 * Thin route-local wrappers around the frozen `lib/lifecycle/refund` surface
 * — same reasoning as `app/admin/organizers/actions.ts` / `app/admin/review/actions.ts`:
 *   1. The lib actions THROW (`Forbidden`, `Refund request not found`,
 *      `Invalid transition from X to Y`). A client component needs a
 *      structured result it can turn into a toast, not an unhandled server
 *      action rejection.
 *   2. The refunds page is dynamically rendered off the session cookie, so
 *      it needs an explicit `revalidatePath` after a mutation.
 *
 * Authorization is NOT re-implemented here. `approveRefund` / `rejectRefund`
 * derive the actor from `getSession()` and call `requireRole` themselves;
 * adding a second check here would be a stale duplicate.
 */

export interface RefundActionResult {
  ok: boolean;
  error?: string;
}

const GENERIC_ERROR = "Something went wrong. Try again.";

// Allowlist of error messages `lib/lifecycle/refund.ts` throws on purpose —
// safe to show a caller verbatim because they're deliberately-worded
// application errors, never a raw DB/driver message. Everything else (a
// Postgres FK violation, a connection drop, any error this file doesn't
// know about) falls through to the generic message below: NEW-5 from the
// round-2 red-team review found the old `return error.message` fallback
// would pass a raw Postgres error straight to the client for any
// unrecognized failure (e.g. the `approver_id` FK violation exercised by
// the two-phase-commit regression tests), leaking internal schema/driver
// detail per CLAUDE.md's "never leak stack traces or internal paths to
// clients." Exact strings for fixed messages; predicates for messages with
// a variable suffix (status/character-count values that are themselves
// safe to show).
const KNOWN_ERROR_MESSAGES = new Set([
  "Refund request not found",
  "Payment not found",
  "Payment has no provider payment id",
  "Refund request payment does not match registration",
  "Refund amount does not match payment amount",
  "A refund request is already pending for this payment",
]);

function isKnownApplicationError(message: string): boolean {
  if (KNOWN_ERROR_MESSAGES.has(message)) return true;
  return (
    message.startsWith("Invalid transition from ") ||
    message.startsWith("Cannot refund a payment with status ") ||
    message.startsWith("Cannot request a refund for a payment with status ") ||
    message.startsWith("Reason must be ")
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Forbidden") {
      return "You no longer have permission to manage refunds. Sign in again.";
    }
    if (isKnownApplicationError(error.message)) {
      return error.message;
    }
  }
  // Deliberately does not surface `error` — could be a raw DB/driver error
  // (e.g. a foreign-key violation). Full detail belongs in server logs only.
  console.error("Unexpected error in refund action:", error);
  return GENERIC_ERROR;
}

export async function approveRefundAction(refundRequestId: string): Promise<RefundActionResult> {
  try {
    await approveRefund(refundRequestId);
    revalidatePath("/admin/refunds");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function rejectRefundAction(
  refundRequestId: string,
  reason: string
): Promise<RefundActionResult> {
  try {
    await rejectRefund(refundRequestId, reason);
    revalidatePath("/admin/refunds");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}
