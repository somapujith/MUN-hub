"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/lib/session";
import {
  createEbMember,
  deleteEbMember,
  updateEbMember,
} from "@/lib/actions/executive-board";
import type { EbRole } from "@/lib/db/schema-enums";

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: never } : { data: T }))
  | { ok: false; error: string };

export interface ExecutiveBoardFormValues {
  name: string;
  role: EbRole;
  customRole: string;
  committeeId: string;
  photoUrl: string;
  bio: string;
  institution: string;
  organization: string;
  socialLinks: string;
  isPublic: boolean;
  displayOrder: number;
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Forbidden") {
      return "You no longer have permission to edit this conference. Sign in again.";
    }
    if (error.message === "Executive board member not found") {
      return "That board member was already removed. Reload the page.";
    }
    if (error.message === "Committee not found") {
      return "That committee was already removed. Reload the page.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

function revalidateSection(munId: string): void {
  revalidatePath(`/organizer/dashboard/${munId}/executive-board`);
}

function normalise(values: ExecutiveBoardFormValues) {
  return {
    name: values.name.trim(),
    role: values.role,
    customRole: optional(values.customRole),
    committeeId: values.committeeId || undefined,
    photoUrl: optional(values.photoUrl),
    bio: optional(values.bio),
    institution: optional(values.institution),
    organization: optional(values.organization),
    socialLinks: values.socialLinks.trim() ? { website: values.socialLinks.trim() } : null,
    isPublic: values.isPublic,
    displayOrder: values.displayOrder,
  };
}

function validate(values: ExecutiveBoardFormValues): string | null {
  if (!values.name.trim()) return "Give this board member a name.";
  if (values.role === "CUSTOM" && !values.customRole.trim()) {
    return "Add a custom role name.";
  }
  if (!Number.isInteger(values.displayOrder) || values.displayOrder < 0) {
    return "Display order must be a whole number, zero or more.";
  }
  return null;
}

export async function createExecutiveBoardAction(
  munId: string,
  values: ExecutiveBoardFormValues,
): Promise<ActionResult<{ id: string; name: string }>> {
  const invalid = validate(values);
  if (invalid) return { ok: false, error: invalid };
  try {
    const member = await createEbMember({ munId, ...normalise(values) }, await getSession());
    revalidateSection(munId);
    return { ok: true, data: { id: member.id, name: member.name } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function updateExecutiveBoardAction(
  munId: string,
  memberId: string,
  values: ExecutiveBoardFormValues,
): Promise<ActionResult<{ id: string; name: string }>> {
  const invalid = validate(values);
  if (invalid) return { ok: false, error: invalid };
  try {
    const member = await updateEbMember(memberId, normalise(values), await getSession());
    revalidateSection(munId);
    return { ok: true, data: { id: member.id, name: member.name } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function deleteExecutiveBoardAction(
  munId: string,
  memberId: string,
): Promise<ActionResult> {
  try {
    await deleteEbMember(memberId, await getSession());
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}