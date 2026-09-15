"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/lib/session";
import { reviewModule, type IssueInput } from "@/lib/lifecycle/module-verification";
import type { MunModule, VerificationSeverity } from "@/lib/db/schema-enums";

export type ModuleReviewDecision = "VERIFIED" | "CHANGES_REQUESTED" | "REJECTED";

export interface ModuleReviewResult {
  ok: boolean;
  error?: string;
}

/**
 * Server-action wrapper around `reviewModule` — the actor is derived from
 * `getSession()` here, never trusted from the client. `reviewModule` itself
 * re-checks the OPERATIONS/ADMIN/SUPER_ADMIN role requirement, so a tampered
 * request buys nothing; this wrapper exists only to convert a `FormData`
 * payload into the typed `IssueInput[]` the contract expects and to turn a
 * thrown error into a result the client component can render inline.
 */
export async function submitModuleReview(
  munId: string,
  moduleName: MunModule,
  decision: ModuleReviewDecision,
  formData: FormData,
): Promise<ModuleReviewResult> {
  const session = await getSession();

  const reason = String(formData.get("reason") ?? "").trim();
  const severity = String(formData.get("severity") ?? "MEDIUM") as VerificationSeverity;

  const issues: IssueInput[] = reason
    ? [{ severity, reason, previousValue: undefined, newValue: undefined }]
    : [];

  try {
    await reviewModule(munId, moduleName, decision, issues, session);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Something went wrong recording this decision.",
    };
  }

  revalidatePath("/admin/verification");
  return { ok: true };
}
