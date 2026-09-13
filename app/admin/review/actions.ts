"use server";

import { revalidatePath } from "next/cache";
import {
  publishMun,
  reinstateMun,
  reviewMunApplication,
  suspendMun,
  unpublishMun,
} from "@/lib/actions/admin-review";
import type { MunStatus } from "@/lib/db/schema-enums";

/**
 * Thin route-local wrappers around the frozen `lib/actions/admin-review`
 * surface.
 *
 * Two reasons these exist instead of calling the lib actions straight from the
 * client component:
 *   1. The lib actions THROW (`Forbidden`, `Mun not found`, `Invalid transition
 *      from X to Y`). A client component needs a structured result it can turn
 *      into a toast, not an unhandled server-action rejection.
 *   2. The queue page is dynamically rendered off the session cookie, so it
 *      needs an explicit `revalidatePath` after a mutation — otherwise the
 *      decided row lingers in the client router cache and the UI looks
 *      optimistic/fake even though the DB moved.
 *
 * Authorization is NOT re-implemented here. `reviewMunApplication` /
 * `publishMun` derive the actor from `getSession()` and call `requireRole`
 * themselves; adding a second check here would be a stale duplicate.
 */

export type ReviewDecision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

export type ReviewActionResult =
  | { ok: true; status: MunStatus }
  | { ok: false; error: string };

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Forbidden") {
      return "You no longer have permission to review applications. Sign in again.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

export async function submitReviewDecision(
  munId: string,
  decision: ReviewDecision,
  notes?: string,
  internalNotes?: string
): Promise<ReviewActionResult> {
  try {
    const mun = await reviewMunApplication(
      munId,
      decision,
      notes?.trim() || undefined,
      internalNotes?.trim() || undefined
    );
    revalidatePath("/admin/review");
    return { ok: true, status: mun.status };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function publishMunAction(munId: string): Promise<ReviewActionResult> {
  try {
    const mun = await publishMun(munId);
    revalidatePath("/admin/review");
    return { ok: true, status: mun.status };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function unpublishMunAction(munId: string): Promise<ReviewActionResult> {
  try {
    const mun = await unpublishMun(munId);
    revalidatePath("/admin/review");
    return { ok: true, status: mun.status };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function suspendMunAction(munId: string, reason: string): Promise<ReviewActionResult> {
  try {
    const mun = await suspendMun(munId, reason);
    revalidatePath("/admin/review");
    return { ok: true, status: mun.status };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function reinstateMunAction(munId: string): Promise<ReviewActionResult> {
  try {
    const mun = await reinstateMun(munId);
    revalidatePath("/admin/review");
    return { ok: true, status: mun.status };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}
