import * as React from "react";
import { GripVerticalIcon, SettingsIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { FormField } from "@/lib/actions/registration-form";

interface FormFieldListProps {
  fields: FormField[];
  selectedFieldId: string | null;
  onSelect: (id: string | null) => void;
  onReorder: (fields: FormField[]) => void;
  onDuplicate?: (id: string) => void;
  isPreviewMode?: boolean;
}

export function FormFieldList({ fields, selectedFieldId, onSelect, onReorder, onDuplicate, isPreviewMode }: FormFieldListProps) {
  const moveUp = (index: number) => {
    if (index === 0) return;
    const newFields = [...fields];
    const temp = newFields[index - 1];
    newFields[index - 1] = newFields[index];
    newFields[index] = temp;
    onReorder(newFields);
  };

  const moveDown = (index: number) => {
    if (index === fields.length - 1) return;
    const newFields = [...fields];
    const temp = newFields[index + 1];
    newFields[index + 1] = newFields[index];
    newFields[index] = temp;
    onReorder(newFields);
  };

  return (
    <div className="flex flex-col gap-4">
      {fields.map((field, index) => {
        const isSelected = field.id === selectedFieldId;
        const isChoice = field.fieldType === "DROPDOWN" || field.fieldType === "MULTIPLE_CHOICE" || field.fieldType === "CHECKBOX";
        const choices = (field.choices as string[]) || ["Option 1"];
        
        return (
          <div
            key={field.id}
            onClick={() => !isPreviewMode && onSelect(field.id)}
            className={`group relative flex gap-3 p-5 transition-all ${
              isPreviewMode 
                ? "border-b border-transparent py-6"
                : `border rounded-xl cursor-pointer ${isSelected ? "border-primary ring-1 ring-primary shadow-sm bg-primary/[0.02]" : "border-border bg-card hover:border-primary/30 hover:shadow-sm"}`
            }`}
          >
            {/* Reorder controls - Only visible on hover or when selected */}
            {!isPreviewMode && (
              <div className={`flex flex-col gap-1 items-center justify-center text-muted-foreground transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); moveUp(index); }}
                  disabled={index === 0}
                  className="disabled:opacity-20 hover:text-primary transition-colors p-1"
                  aria-label="Move up"
                >
                  ▲
                </button>
                <GripVerticalIcon className="h-4 w-4" />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); moveDown(index); }}
                  disabled={index === fields.length - 1}
                  className="disabled:opacity-20 hover:text-primary transition-colors p-1"
                  aria-label="Move down"
                >
                  ▼
                </button>
              </div>
            )}

            <div className="flex-1 flex flex-col gap-3 min-w-0 pr-12 pointer-events-none">
              <div className="flex items-center gap-2">
                <Label className="text-base font-medium">
                  {field.label || "Unnamed Field"}
                  {field.required && <span className="text-destructive-text ml-1">*</span>}
                </Label>
                {field.conditionalOn && (
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full dark:bg-blue-900/30 dark:text-blue-400">
                    Conditional
                  </span>
                )}
              </div>
              
              {field.helpText && (
                <p className="text-sm text-muted-foreground">{field.helpText}</p>
              )}

              <div className="mt-1">
                {isChoice ? (
                  field.fieldType === "CHECKBOX" ? (
                    <div className="flex flex-col gap-2">
                      {choices.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Checkbox id={`${field.id}-choice-${i}`} disabled />
                          <Label className="text-sm text-muted-foreground font-normal">{c}</Label>
                        </div>
                      ))}
                    </div>
                  ) : field.fieldType === "MULTIPLE_CHOICE" ? (
                    <div className="flex flex-col gap-2">
                      {choices.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="h-4 w-4 rounded-full border border-primary/50" />
                          <Label className="text-sm text-muted-foreground font-normal">{c}</Label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <select disabled className="h-10 w-full md:w-2/3 rounded-md border border-input bg-background/50 px-3 py-2 text-sm text-muted-foreground outline-none opacity-70">
                      <option>{choices[0]}</option>
                    </select>
                  )
                ) : field.fieldType === "LONG_TEXT" ? (
                  <div className="h-24 w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm text-muted-foreground opacity-70">
                    Long text answer...
                  </div>
                ) : (
                  <Input disabled placeholder={`${field.fieldType.replace("_", " ").toLowerCase()} answer...`} className="md:w-2/3 opacity-70" />
                )}
              </div>
            </div>

            {/* Configure button overlay */}
            {!isPreviewMode && (
              <div className={`absolute top-4 right-4 flex items-center gap-2 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                {onDuplicate && (
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={(e) => { e.stopPropagation(); onDuplicate(field.id); }}
                    title="Duplicate field"
                    className="shadow-sm h-8 w-8"
                  >
                    <CopyIcon className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
                <Button
                  variant={isSelected ? "default" : "secondary"}
                  size="sm"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    onSelect(isSelected ? null : field.id); 
                  }}
                  className="shadow-sm h-8"
                >
                  <SettingsIcon className="mr-2 h-4 w-4" />
                  {isSelected ? "Editing" : "Edit"}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
