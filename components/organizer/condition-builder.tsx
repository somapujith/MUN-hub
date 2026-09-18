import * as React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { FormField } from "@/lib/actions/registration-form";

interface ConditionBuilderProps {
  field: FormField;
  allFields: FormField[];
  onUpdate: (field: FormField) => void;
}

export function ConditionBuilder({ field, allFields, onUpdate }: ConditionBuilderProps) {
  // Only fields that come before this one can be used for conditions to avoid forward references/cycles.
  const eligibleFields = allFields.filter(
    (f) => f.id !== field.id && f.displayOrder < field.displayOrder
  );

  const hasCondition = !!field.conditionalOn;

  const handleToggleCondition = () => {
    if (hasCondition) {
      onUpdate({ ...field, conditionalOn: null, conditionalOperator: null, conditionalValue: null });
    } else {
      if (eligibleFields.length > 0) {
        onUpdate({ 
          ...field, 
          conditionalOn: eligibleFields[0].fieldKey, 
          conditionalOperator: "EQUALS", 
          conditionalValue: "" 
        });
      }
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-6 mt-2 border-t">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Conditional Logic</Label>
        <Button 
          variant={hasCondition ? "ghost" : "outline"}
          size="sm" 
          onClick={handleToggleCondition}
          disabled={!hasCondition && eligibleFields.length === 0}
          className={hasCondition ? "text-destructive-text hover:text-destructive-text hover:bg-destructive/10" : ""}
        >
          {hasCondition ? "Remove" : "Add Condition"}
        </Button>
      </div>
      
      {!hasCondition && eligibleFields.length === 0 && (
        <div className="bg-surface-soft p-3 rounded-lg border border-border/50">
          <p className="text-xs text-muted-foreground text-center">
            No eligible fields found. Add a field above this one to use conditional logic.
          </p>
        </div>
      )}

      {hasCondition && (
        <div className="flex flex-col gap-3 p-4 bg-surface-soft rounded-lg border border-border/50 shadow-inner-sm">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Show this field if</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={field.conditionalOn || ""}
              onChange={(e) => onUpdate({ ...field, conditionalOn: e.target.value })}
            >
              {eligibleFields.map((f) => (
                <option key={f.id} value={f.fieldKey}>
                  {f.label || f.fieldKey}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <div className="flex flex-col gap-1.5 flex-1">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Operator</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={field.conditionalOperator || "EQUALS"}
                onChange={(e) => onUpdate({ ...field, conditionalOperator: e.target.value as any })}
              >
                <option value="EQUALS">Equals</option>
                <option value="NOT_EQUALS">Not Equals</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5 flex-[1.5]">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Value</Label>
              <Input
                className="h-9 bg-background"
                value={field.conditionalValue || ""}
                onChange={(e) => onUpdate({ ...field, conditionalValue: e.target.value })}
                placeholder="Value..."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
