"use server";

import { revalidatePath } from "next/cache";
import { reinstateOrganizer, suspendOrganizer } from "@/lib/actions/organizer-admin";
import { getSession } from "@/app/lib/session";

/**
 * Thin route-local wrappers around the frozen `lib/actions/organizer-admin`
 * surface — same reasoning as `app/admin/review/actions.ts`:
 *   1. The lib actions THROW (`Forbidden`). A client component needs a
 *      structured result it can turn into a toast, not an unhandled server
 *      action rejection.
 *   2. The organizers page is dynamically rendered off the session cookie,
 *      so it needs an explicit `revalidatePath` after a mutation.
 *
 * Authorization is NOT re-implemented here. `suspendOrganizer` /
 * `reinstateOrganizer` derive the actor from `getSession()` and call
 * `requireRole` themselves; adding a second check here would be a stale
 * duplicate.
 */

export interface OrganizerActionResult {
  ok: boolean;
  error?: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Forbidden") {
      return "You no longer have permission to manage organizers. Sign in again.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

export async function suspendOrganizerAction(
  userId: string,
  reason: string
): Promise<OrganizerActionResult> {
  try {
    await suspendOrganizer(userId, reason, await getSession());
    revalidatePath("/admin/organizers");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function reinstateOrganizerAction(userId: string): Promise<OrganizerActionResult> {
  try {
    await reinstateOrganizer(userId, await getSession());
    revalidatePath("/admin/organizers");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}
