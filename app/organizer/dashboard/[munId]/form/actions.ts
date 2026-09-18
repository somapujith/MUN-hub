"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/app/lib/session";
import { 
  listFormFields, 
  createFormField, 
  updateFormField, 
  deleteFormField, 
  reorderFormFields,
  type FormField
} from "@/lib/actions/registration-form";

export async function saveRegistrationFormAction(
  munId: string, 
  clientFields: FormField[]
) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const existingFields = await listFormFields(munId);
  const existingMap = new Map(existingFields.map((f) => [f.id, f]));
  const clientMap = new Map(clientFields.map((f) => [f.id, f]));

  // Find deletions
  for (const existing of existingFields) {
    if (!clientMap.has(existing.id)) {
      await deleteFormField(existing.id, session);
    }
  }

  // Find creations and updates
  // We should create/update sequentially so that conditional logic dependencies are respected if possible.
  // Actually, since conditional logic depends on fieldKey, and cycle detection runs on every save,
  // we first create all missing fields, then update, then do a final bulk reorder.
  
  const createdIds = new Map<string, string>(); // client tempId -> db id

  for (const clientField of clientFields) {
    if (!existingMap.has(clientField.id) || clientField.id.startsWith("temp-")) {
      const created = await createFormField({
        munId,
        fieldKey: clientField.fieldKey,
        fieldType: clientField.fieldType,
        label: clientField.label,
        helpText: clientField.helpText,
        required: clientField.required,
        choices: clientField.choices as string[] | null,
        displayOrder: clientField.displayOrder,
        conditionalOn: clientField.conditionalOn,
        conditionalOperator: clientField.conditionalOperator as any,
        conditionalValue: clientField.conditionalValue,
      }, session);
      createdIds.set(clientField.id, created.id);
    } else {
      await updateFormField(clientField.id, {
        fieldKey: clientField.fieldKey,
        fieldType: clientField.fieldType,
        label: clientField.label,
        helpText: clientField.helpText,
        required: clientField.required,
        choices: clientField.choices as string[] | null,
        displayOrder: clientField.displayOrder,
        conditionalOn: clientField.conditionalOn,
        conditionalOperator: clientField.conditionalOperator as any,
        conditionalValue: clientField.conditionalValue,
      }, session);
    }
  }

  // Finally reorder them properly based on the client array
  const orderInput = clientFields.map((f, i) => ({
    id: createdIds.get(f.id) || f.id,
    displayOrder: i,
  }));
  
  await reorderFormFields({ munId, order: orderInput }, session);

  revalidatePath(`/organizer/dashboard/${munId}/form`);
  
  return { success: true };
}
