"use client";

import * as React from "react";
import { PlusIcon, SaveIcon, EyeIcon, EyeOffIcon, Loader2Icon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormFieldEditor } from "@/components/organizer/form-field-editor";
import { FormFieldList } from "@/components/organizer/form-field-list";
import { saveRegistrationFormAction } from "@/app/organizer/dashboard/[munId]/form/actions";
import type { FormField } from "@/lib/actions/registration-form";
import type { FormFieldType } from "@/lib/db/schema-enums";

export interface RegistrationFormBuilderProps {
  munId: string;
  initialFields: FormField[];
}

const FIELD_LIBRARY: { label: string; type: FormFieldType; category: string }[] = [
  { label: "Short text", type: "SHORT_TEXT", category: "Text" },
  { label: "Long text", type: "LONG_TEXT", category: "Text" },
  { label: "Email", type: "EMAIL", category: "Contact" },
  { label: "Phone", type: "PHONE", category: "Contact" },
  { label: "Number", type: "NUMBER", category: "Other" },
  { label: "Date", type: "DATE", category: "Other" },
  { label: "Dropdown", type: "DROPDOWN", category: "Choice" },
  { label: "Multiple choice", type: "MULTIPLE_CHOICE", category: "Choice" },
  { label: "Checkbox", type: "CHECKBOX", category: "Choice" },
  { label: "File upload", type: "FILE_UPLOAD", category: "Other" },
  { label: "Institution", type: "INSTITUTION", category: "Special" },
  { label: "Academic year", type: "ACADEMIC_YEAR", category: "Special" },
  { label: "MUN experience", type: "MUN_EXPERIENCE", category: "Special" },
  { label: "Committee preference", type: "COMMITTEE_PREFERENCE", category: "Special" },
  { label: "Portfolio preference", type: "PORTFOLIO_PREFERENCE", category: "Special" },
  { label: "Emergency contact", type: "EMERGENCY_CONTACT", category: "Special" },
];

export function RegistrationFormBuilder({ munId, initialFields }: RegistrationFormBuilderProps) {
  const [fields, setFields] = React.useState<FormField[]>(initialFields);
  const [lastSavedFields, setLastSavedFields] = React.useState<FormField[]>(initialFields);
  const [selectedFieldId, setSelectedFieldId] = React.useState<string | null>(null);
  const [isPreviewMode, setIsPreviewMode] = React.useState(false);
  const [isSaving, startTransition] = React.useTransition();

  const isDirty = JSON.stringify(fields) !== JSON.stringify(lastSavedFields);

  const selectedField = React.useMemo(
    () => fields.find((f) => f.id === selectedFieldId) || null,
    [fields, selectedFieldId]
  );

  const handleAddField = (type: FormFieldType) => {
    const tempId = `temp-${Date.now()}`;
    const newField: FormField = {
      id: tempId,
      munId,
      fieldKey: `field_${Date.now()}`,
      fieldType: type,
      label: "New Field",
      helpText: null,
      required: false,
      choices: type === "DROPDOWN" || type === "MULTIPLE_CHOICE" || type === "CHECKBOX" ? ["Option 1"] : null,
      displayOrder: fields.length,
      conditionalOn: null,
      conditionalOperator: null,
      conditionalValue: null,
      createdAt: new Date(),
    };
    setFields([...fields, newField]);
    setSelectedFieldId(tempId);
  };

  const handleUpdateField = (updated: FormField) => {
    setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  };

  const handleDeleteField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedFieldId === id) setSelectedFieldId(null);
  };

  const handleDuplicateField = (id: string) => {
    const fieldToCopy = fields.find((f) => f.id === id);
    if (!fieldToCopy) return;
    
    const newId = `temp-${Date.now()}`;
    const newField = {
      ...fieldToCopy,
      id: newId,
      fieldKey: `field_${Date.now()}`,
      label: `${fieldToCopy.label} (Copy)`,
      displayOrder: fields.length,
      createdAt: new Date(),
    };
    
    setFields([...fields, newField]);
    setSelectedFieldId(newId);
    toast.success("Field duplicated");
  };

  const handleReorder = (newFields: FormField[]) => {
    const ordered = newFields.map((f, i) => ({ ...f, displayOrder: i }));
    setFields(ordered);
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        await saveRegistrationFormAction(munId, fields);
        setLastSavedFields(fields);
        toast.success("Form configuration saved successfully");
      } catch (err: any) {
        toast.error(err.message || "Failed to save form configuration");
      }
    });
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <header className="flex items-center justify-between border-b pb-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Form Builder</h2>
          <p className="text-sm text-muted-foreground">
            Configure the questions participants will answer when registering.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {isDirty && <span className="text-xs text-amber-600 font-medium mr-2">Unsaved changes</span>}
          <Button variant="outline" size="sm" onClick={() => setIsPreviewMode(!isPreviewMode)}>
            {isPreviewMode ? <EyeOffIcon className="mr-2 h-4 w-4" /> : <EyeIcon className="mr-2 h-4 w-4" />}
            {isPreviewMode ? "Exit Preview" : "Preview"}
          </Button>
          {!isPreviewMode && (
            <Button variant="outline" size="sm" onClick={() => setSelectedFieldId(null)}>
              <PlusIcon className="mr-2 h-4 w-4" />
              Add Field
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={isSaving || !isDirty}>
            {isSaving ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <SaveIcon className="mr-2 h-4 w-4" />}
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </header>

      <div className={`grid gap-8 items-start pb-12 ${isPreviewMode ? 'grid-cols-1 max-w-3xl mx-auto' : 'grid-cols-1 lg:grid-cols-[1fr_350px]'}`}>
        <main className="flex flex-col gap-6 w-full">
          <div className="bg-card border rounded-xl shadow-sm p-6 min-h-[400px]">
            <h3 className="font-semibold mb-6 text-lg border-b pb-4">Registration Form</h3>
            {fields.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-lg bg-surface-soft/50">
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                  <PlusIcon className="h-8 w-8 text-primary" />
                </div>
                <h4 className="text-lg font-medium text-ink">No fields yet</h4>
                <p className="text-sm text-muted-foreground max-w-sm mt-2">
                  Build your registration form by adding fields from the library on the right.
                </p>
                <Button 
                  variant="outline" 
                  className="mt-6"
                  onClick={() => setSelectedFieldId(null)}
                >
                  Open Field Library
                </Button>
              </div>
            ) : (
              <FormFieldList
                fields={fields}
                selectedFieldId={selectedFieldId}
                onSelect={setSelectedFieldId}
                onReorder={handleReorder}
                onDuplicate={handleDuplicateField}
                isPreviewMode={isPreviewMode}
              />
            )}
          </div>
        </main>

        {!isPreviewMode && (
          <aside className="flex flex-col sticky top-6 bg-card border rounded-xl shadow-sm overflow-hidden h-[calc(100vh-140px)]">
          {selectedField ? (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b bg-surface-soft">
                <h3 className="font-semibold flex items-center justify-between">
                  Field Properties
                  <Button variant="ghost" size="sm" onClick={() => setSelectedFieldId(null)}>
                    Done
                  </Button>
                </h3>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <FormFieldEditor
                  field={selectedField}
                  munId={munId}
                  allFields={fields}
                  onUpdate={handleUpdateField}
                  onDelete={() => handleDeleteField(selectedField.id)}
                  onDuplicate={() => handleDuplicateField(selectedField.id)}
                  onClose={() => setSelectedFieldId(null)}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="p-4 border-b bg-surface-soft">
                <h3 className="font-semibold">Field Library</h3>
                <p className="text-xs text-muted-foreground mt-1">Click a field type to add it</p>
              </div>
              <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-6">
                {Array.from(new Set(FIELD_LIBRARY.map(f => f.category))).map(category => (
                  <div key={category} className="flex flex-col gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {category}
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {FIELD_LIBRARY.filter(f => f.category === category).map((fieldOption) => (
                        <Button
                          key={fieldOption.type}
                          variant="outline"
                          className="justify-start text-xs h-auto py-2 px-3 hover:border-primary/50 hover:bg-primary/5 transition-colors"
                          onClick={() => handleAddField(fieldOption.type)}
                        >
                          {fieldOption.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </aside>
        )}
      </div>
    </div>
  );
}
