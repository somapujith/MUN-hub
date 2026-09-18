import * as React from "react";
import { TrashIcon, XIcon, PlusIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { FormField } from "@/lib/actions/registration-form";
import { ConditionBuilder } from "@/components/organizer/condition-builder";

interface FormFieldEditorProps {
  field: FormField;
  munId: string;
  allFields: FormField[];
  onUpdate: (field: FormField) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onClose: () => void;
}

export function FormFieldEditor({ field, munId, allFields, onUpdate, onDelete, onDuplicate, onClose }: FormFieldEditorProps) {
  const isChoiceField = field.fieldType === "DROPDOWN" || field.fieldType === "MULTIPLE_CHOICE" || field.fieldType === "CHECKBOX";
  const choices = Array.isArray(field.choices) ? (field.choices as string[]) : [];

  const handleChoiceChange = (index: number, value: string) => {
    const newChoices = [...choices];
    newChoices[index] = value;
    onUpdate({ ...field, choices: newChoices });
  };

  const handleAddChoice = () => {
    onUpdate({ ...field, choices: [...choices, `Option ${choices.length + 1}`] });
  };

  const handleRemoveChoice = (index: number) => {
    const newChoices = choices.filter((_, i) => i !== index);
    onUpdate({ ...field, choices: newChoices.length > 0 ? newChoices : ["Option 1"] });
  };

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex flex-col gap-1">
        <Label htmlFor="label" className="text-sm font-medium">Question text</Label>
        <Input
          id="label"
          value={field.label}
          onChange={(e) => onUpdate({ ...field, label: e.target.value })}
          placeholder="e.g., Institution Name"
          className="font-medium"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="helpText" className="text-sm font-medium">Description (Optional)</Label>
        <Input
          id="helpText"
          value={field.helpText || ""}
          onChange={(e) => onUpdate({ ...field, helpText: e.target.value || null })}
          placeholder="e.g., Use the official institution name."
        />
      </div>

      <div className="flex items-center gap-2 py-2 p-3 bg-surface-soft rounded-lg border border-border/50">
        <Checkbox
          id="required"
          checked={field.required}
          onCheckedChange={(checked) => onUpdate({ ...field, required: !!checked })}
        />
        <Label htmlFor="required" className="font-medium cursor-pointer flex-1">
          Make this field required
        </Label>
      </div>

      {isChoiceField && (
        <div className="flex flex-col gap-3">
          <Label className="text-sm font-medium">Options</Label>
          <div className="flex flex-col gap-2">
            {choices.map((choice, i) => (
              <div key={i} className="flex gap-2 items-center group">
                <Input
                  value={choice}
                  onChange={(e) => handleChoiceChange(i, e.target.value)}
                  className="flex-1"
                />
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => handleRemoveChoice(i)} 
                  disabled={choices.length <= 1}
                  className="opacity-50 group-hover:opacity-100 transition-opacity"
                >
                  <TrashIcon className="h-4 w-4 text-destructive-text" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={handleAddChoice} className="self-start mt-1">
              <PlusIcon className="mr-2 h-4 w-4" />
              Add option
            </Button>
          </div>
        </div>
      )}

      <ConditionBuilder field={field} allFields={allFields} onUpdate={onUpdate} />

      <div className="flex flex-col gap-3 pt-6 mt-2 border-t">
        <div className="flex flex-col gap-1">
          <Label htmlFor="fieldKey" className="text-sm font-medium text-muted-foreground">Advanced: Field ID</Label>
          <Input
            id="fieldKey"
            value={field.fieldKey}
            onChange={(e) => onUpdate({ ...field, fieldKey: e.target.value })}
            className="font-mono text-xs h-8"
          />
          <p className="text-[10px] text-muted-foreground leading-tight mt-1">
            Unique identifier used for conditions and data exports. Changing this may break existing conditional logic.
          </p>
        </div>
      </div>

      <div className="pt-6 border-t mt-4 flex flex-col gap-2">
        {onDuplicate && (
          <Button variant="outline" onClick={onDuplicate} className="w-full">
            <CopyIcon className="mr-2 h-4 w-4" />
            Duplicate Field
          </Button>
        )}
        <Button variant="ghost" onClick={onDelete} className="w-full text-destructive-text hover:bg-destructive/10 hover:text-destructive-text">
          <TrashIcon className="mr-2 h-4 w-4" />
          Delete Field
        </Button>
      </div>
    </div>
  );
}
