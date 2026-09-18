import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormField } from "@/types";

// -----------------------------------------------------------------------------
// dynamic-field — the organizer's configured registration-form question
// renderer, extracted out of registration-form.tsx (2026-09-17) so the
// group/delegation flow's own funnel steps (group-register-page.tsx, the
// invitation-accept flow) can render the exact same per-mun questions instead
// of forking a second copy of this markup/logic.
// -----------------------------------------------------------------------------

export const controlClassName = cn(
  "h-11 w-full rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
);

export const textareaClassName = cn(controlClassName, "h-auto min-h-24 resize-y");

/**
 * The account already knows the delegate's name and email, and the
 * organizer's own form never asks for them — so they're collected as fixed
 * core fields rather than organizer-configured ones.
 */
export const CORE_KEYS = ["fullName", "email", "phone"] as const;
export type CoreKey = (typeof CORE_KEYS)[number];

export const CORE_LABELS: Record<CoreKey, string> = {
  fullName: "Full name",
  email: "Email",
  phone: "Phone",
};

/** Single-parent conditional visibility, matching the builder's model. */
export function isFieldVisible(field: FormField, answers: Record<string, string>): boolean {
  if (!field.conditionalOn) return true;
  const parent = (answers[field.conditionalOn] ?? "").trim();
  const expected = (field.conditionalValue ?? "").trim();
  switch (field.conditionalOperator) {
    case "NOT_EQUALS":
      return parent !== expected;
    case "CONTAINS":
      return parent.toLowerCase().includes(expected.toLowerCase());
    case "EQUALS":
    default:
      return parent === expected;
  }
}

export function DynamicField({
  field,
  value,
  onChange,
  showError,
}: {
  field: FormField;
  value: string;
  onChange: (next: string) => void;
  showError: boolean;
}) {
  const invalid = showError && field.required && !value.trim();
  const helpId = field.helpText ? `${field.fieldKey}-help` : undefined;
  const errorId = invalid ? `${field.fieldKey}-error` : undefined;
  // Both ids when both are present, so a screen reader announces the help
  // text and the "is required" error together — not just whichever the field
  // happened to declare first.
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  const choices = field.choices ?? [];
  const isChoice = choices.length > 0;
  const isLong = field.fieldType === "LONG_TEXT" || field.fieldType === "MUN_EXPERIENCE";

  const inputType =
    field.fieldType === "EMAIL"
      ? "email"
      : field.fieldType === "PHONE"
        ? "tel"
        : field.fieldType === "NUMBER"
          ? "number"
          : field.fieldType === "DATE"
            ? "date"
            : "text";

  return (
    <div className={cn("flex flex-col gap-xs", (isLong || isChoice) && "sm:col-span-2")}>
      <Label htmlFor={field.fieldKey}>
        {field.label}
        {field.required && (
          <span className="text-destructive-text" aria-hidden>
            *
          </span>
        )}
      </Label>

      {isChoice ? (
        <select
          id={field.fieldKey}
          className={controlClassName}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        >
          <option value="">Select an option</option>
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : isLong ? (
        <textarea
          id={field.fieldKey}
          className={textareaClassName}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      ) : (
        <Input
          id={field.fieldKey}
          type={inputType}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      )}

      {field.helpText && (
        <p id={helpId} className="text-body-md text-muted-foreground">
          {field.helpText}
        </p>
      )}
      {invalid && (
        <p id={errorId} role="alert" className="text-body-md text-destructive-text">
          {field.label} is required.
        </p>
      )}
    </div>
  );
}
