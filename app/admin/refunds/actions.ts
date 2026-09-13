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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Forbidden") {
      return "You no longer have permission to manage refunds. Sign in again.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
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
