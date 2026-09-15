"use server";

import { revalidatePath } from "next/cache";
import { assignTicket, updateTicketStatus } from "@/lib/actions/support";
import { getSession } from "@/app/lib/session";

/**
 * Thin route-local wrappers around the `lib/actions/support` surface — same
 * reasoning as `app/admin/organizers/actions.ts`:
 *   1. The lib actions THROW (`Forbidden`). A client component needs a
 *      structured result it can turn into a toast, not an unhandled server
 *      action rejection.
 *   2. The support page is dynamically rendered off the session cookie, so
 *      it needs an explicit `revalidatePath` after a mutation.
 *
 * Authorization is NOT re-implemented here. `assignTicket` / `updateTicketStatus`
 * derive the actor from `getSession()` and call `requireRole` themselves;
 * adding a second check here would be a stale duplicate.
 */

export interface SupportActionResult {
  ok: boolean;
  error?: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Forbidden") {
      return "You no longer have permission to manage support tickets. Sign in again.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

export async function assignTicketToSelfAction(
  ticketId: string
): Promise<SupportActionResult> {
  try {
    await assignTicket(ticketId, await getSession());
    revalidatePath("/admin/support");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function resolveTicketAction(
  ticketId: string,
  resolutionNotes: string
): Promise<SupportActionResult> {
  try {
    await updateTicketStatus(ticketId, "RESOLVED", resolutionNotes, await getSession());
    revalidatePath("/admin/support");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function markTicketInProgressAction(ticketId: string): Promise<SupportActionResult> {
  try {
    await updateTicketStatus(ticketId, "IN_PROGRESS", undefined, await getSession());
    revalidatePath("/admin/support");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}
