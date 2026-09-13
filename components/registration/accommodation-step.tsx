"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AccommodationOptionCard } from "@/components/registration/accommodation-option";
import {
  fieldChoices,
  isMissing,
  type FieldValue,
} from "@/components/registration/accommodation-fields";
import type {
  AccommodationOption,
  AccommodationOptionField,
} from "@/lib/actions/accommodation";

interface AccommodationStepProps {
  /** Pre-filtered to `status === 'active'` server-side. */
  options: AccommodationOption[];
  /** `""` means "No accommodation". */
  optionId: string;
  onOptionChange: (optionId: string) => void;
  /** Fields for `optionId`, fetched on selection. Empty while loading. */
  fields: AccommodationOptionField[];
  loadingFields: boolean;
  loadError: string | null;
  onRetry: () => void;
  values: Record<string, FieldValue>;
  onValueChange: (fieldId: string, value: FieldValue) => void;
  /** Set once the user has tried to advance — gates error text display. */
  showErrors: boolean;
}

/**
 * The optional accommodation step.
 *
 * Every input here is CONTROLLED (`value` + `onChange`), never `defaultValue`.
 * That is not stylistic: the field set is re-fetched whenever the selected
 * option changes, and a `defaultValue` on an input that stays mounted across a
 * field-set swap silently keeps the old value — the exact bug already fixed
 * once in this form. Each input is additionally keyed by field id so React
 * remounts rather than reuses a node when the field list changes shape.
 */
export function AccommodationStep({
  options,
  optionId,
  onOptionChange,
  fields,
  loadingFields,
  loadError,
  onRetry,
  values,
  onValueChange,
  showErrors,
}: AccommodationStepProps) {
  const selectedOption = options.find((option) => option.id === optionId);

  return (
    <>
      <fieldset className="flex flex-col gap-sm">
        <legend className="sr-only">Accommodation option</legend>

        {/* Skip card first: it is the default, and putting it last would read
            as an afterthought below priced options. */}
        <AccommodationOptionCard
          option={null}
          checked={optionId === ""}
          onSelect={onOptionChange}
        />

        {options.map((option) => (
          <AccommodationOptionCard
            key={option.id}
            option={option}
            checked={optionId === option.id}
            onSelect={onOptionChange}
          />
        ))}
      </fieldset>

      {selectedOption && (
        <div className="flex flex-col gap-md border-t border-border pt-lg">
          <div className="flex flex-col gap-xxs">
            <h3 className="text-title-sm text-ink">{selectedOption.name} details</h3>
            <p className="text-body-md text-muted-foreground">
              The organizing team needs these to assign your room.
            </p>
          </div>

          {loadingFields && (
            <p className="inline-flex items-center gap-xs text-body-md text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
              Loading accommodation questions…
            </p>
          )}

          {loadError && (
            <div
              role="alert"
              className="flex flex-col items-start gap-xs rounded-md border border-destructive/30 bg-destructive/8 px-md py-sm text-body-md text-destructive-text"
            >
              <span>{loadError}</span>
              <button
                type="button"
                onClick={onRetry}
                className="text-link underline underline-offset-4"
              >
                Try again
              </button>
            </div>
          )}

          {!loadingFields && !loadError && fields.length === 0 && (
            <p className="rounded-sm bg-surface-soft px-sm py-xs text-body-md text-muted-foreground">
              No extra questions for this option — you&apos;re all set.
            </p>
          )}

          {!loadingFields && !loadError && fields.length > 0 && (
            <div className="grid gap-md sm:grid-cols-2">
              {fields.map((field) => (
                <AccommodationField
                  key={field.id}
                  field={field}
                  value={values[field.id]}
                  onChange={(value) => onValueChange(field.id, value)}
                  showErrors={showErrors}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

const selectClassName = cn(
  "h-11 w-full rounded-sm border border-input bg-background px-md text-body-md text-ink transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30",
  "dark:bg-card",
);

function AccommodationField({
  field,
  value,
  onChange,
  showErrors,
}: {
  field: AccommodationOptionField;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  showErrors: boolean;
}) {
  const inputId = `accommodation-field-${field.id}`;
  const errorId = `${inputId}-error`;
  const invalid = showErrors && field.required && isMissing(field, value);
  const describedBy = invalid ? errorId : undefined;

  const choices = fieldChoices(field);
  const isCheckbox = field.fieldType === "CHECKBOX";

  // CHECKBOX renders a group of boxes, so the group gets a <legend>-bearing
  // fieldset rather than a <label for>: there is no single input to point at.
  const LabelBlock = isCheckbox ? (
    <legend className="flex items-center gap-xs text-body-md leading-none font-medium text-ink">
      {field.label}
      {field.required && (
        <span className="text-destructive-text" aria-hidden>
          *
        </span>
      )}
    </legend>
  ) : (
    <Label htmlFor={inputId}>
      {field.label}
      {field.required && (
        <span className="text-destructive-text" aria-hidden>
          *
        </span>
      )}
    </Label>
  );

  const errorBlock = invalid ? (
    <p id={errorId} className="text-body-md text-destructive-text">
      {field.label} is required.
    </p>
  ) : null;

  if (isCheckbox) {
    const picked = Array.isArray(value) ? value : [];

    return (
      <fieldset
        className={cn("flex flex-col gap-xs", choices.length > 3 && "sm:col-span-2")}
        aria-describedby={describedBy}
      >
        {LabelBlock}
        <div className="flex flex-col gap-xs pt-xxs">
          {choices.map((choice) => {
            const choiceId = `${inputId}-${choice}`;
            const isPicked = picked.includes(choice);

            return (
              <label
                key={choice}
                htmlFor={choiceId}
                className="flex cursor-pointer items-center gap-xs text-body-md text-ink"
              >
                <Checkbox
                  id={choiceId}
                  checked={isPicked}
                  onCheckedChange={(next) =>
                    onChange(
                      next
                        ? [...picked, choice]
                        : picked.filter((entry) => entry !== choice),
                    )
                  }
                />
                {choice}
              </label>
            );
          })}
          {choices.length === 0 && (
            <p className="text-body-md text-muted-foreground">
              No options configured.
            </p>
          )}
        </div>
        {errorBlock}
      </fieldset>
    );
  }

  if (field.fieldType === "DROPDOWN") {
    return (
      <div className="flex flex-col gap-xs">
        {LabelBlock}
        <select
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={selectClassName}
        >
          <option value="">Select an option</option>
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
        {errorBlock}
      </div>
    );
  }

  const inputType =
    field.fieldType === "NUMBER" ? "number" : field.fieldType === "DATE" ? "date" : "text";

  return (
    <div className="flex flex-col gap-xs">
      {LabelBlock}
      <Input
        id={inputId}
        type={inputType}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      {errorBlock}
    </div>
  );
}
