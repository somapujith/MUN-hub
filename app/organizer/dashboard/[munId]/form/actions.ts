"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/lib/session";
import { createFormField, deleteFormField } from "@/lib/actions/registration-form";
import type { FormFieldType } from "@/lib/db/schema-enums";

export async function addFormFieldAction(munId: string, _previous: unknown, formData: FormData) {
  const fieldKey = String(formData.get("fieldKey") ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const label = String(formData.get("label") ?? "").trim();
  const fieldType = String(formData.get("fieldType") ?? "SHORT_TEXT") as FormFieldType;
  const choices = String(formData.get("choices") ?? "").split("\n").map((choice) => choice.trim()).filter(Boolean);
  if (!fieldKey || !label) return { error: "Field key and label are required." };
  try {
    await createFormField({
      munId,
      fieldKey,
      label,
      fieldType,
      required: formData.get("required") === "on",
      choices: ["DROPDOWN", "MULTIPLE_CHOICE", "CHECKBOX"].includes(fieldType) ? choices : null,
      helpText: String(formData.get("helpText") ?? "").trim() || null,
    }, await getSession());
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not add this field." };
  }
  revalidatePath(`/organizer/dashboard/${munId}/form`);
  return { success: "Field added." };
}

export async function deleteFormFieldAction(munId: string, fieldId: string, _previous: unknown, _formData: FormData) {
  try {
    await deleteFormField(fieldId, await getSession());
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not delete this field." };
  }
  revalidatePath(`/organizer/dashboard/${munId}/form`);
  return { success: "Field deleted." };
}
