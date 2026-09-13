"use client";

import * as React from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { CheckIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createFieldAction,
  updateFieldAction,
  type FieldFormValues,
} from "./actions";
import { isChoiceFieldType } from "./field-types";
import type { AccommodationFieldType } from "@/lib/db/schema-enums";
import type { FieldRow } from "./queries";

/**
 * Create/edit dialog for one custom field on an accommodation option.
 *
 * WHY THIS FORM IS PART-CONTROLLED, unlike the option dialog next door.
 *
 * `fieldType` and `choices` are React state, not uncontrolled inputs, because
 * they are COUPLED: the choices editor only exists when the type is DROPDOWN or
 * CHECKBOX, and the submit button's validity depends on both at once. An
 * uncontrolled `<select>` can't drive conditional rendering without a change
 * handler, at which point it is controlled anyway.
 *
 * `label` and `displayOrder` stay uncontrolled — nothing else depends on them.
 * The whole dialog is still remounted by its caller via `key` on the field id
 * (see `accommodation-table.tsx`) so those `defaultValue`s are correct on a
 * reused dialog instance AND so the `useState` initialisers below re-run with
 * the new field's type and choices. Without that key, editing field A then
 * field B would carry A's type and choice list into B's form — the
 * `useState`-initialiser-runs-once trap, which is the same class of bug as the
 * uncontrolled-defaultValue one but survives a naive fix to the inputs alone.
 */

const FIELD_TYPE_OPTIONS: readonly {
  value: AccommodationFieldType;
  label: string;
  hint: string;
}[] = [
  { value: "TEXT", label: "Text", hint: "A short free-text answer." },
  { value: "NUMBER", label: "Number", hint: "A numeric answer." },
  { value: "DATE", label: "Date", hint: "A single calendar date." },
  {
    value: "DROPDOWN",
    label: "Dropdown",
    hint: "Pick exactly one of your choices.",
  },
  {
    value: "CHECKBOX",
    label: "Checkboxes",
    hint: "Pick any number of your choices.",
  },
];

/**
 * A native `<select>` styled to match `<Input>`. Same reasoning as
 * `products/product-form-dialog.tsx`: this sits inside a dialog, and a
 * portalled listbox layered over a portalled dialog is a focus-trap fight for
 * five static options. The chevron is an inline SVG data URI kept in a constant
 * because its `>` characters would terminate the JSX tag inside a className.
 */
const CHEVRON_SVG =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2341454d' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E";

const selectClassName = cn(
  "h-11 w-full min-w-0 cursor-pointer appearance-none rounded-sm border border-input bg-background bg-[length:14px] bg-[right_12px_center] bg-no-repeat px-md py-sm pr-8 text-body-md text-ink transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:border-border-strong disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card",
);

interface AccommodationFieldDialogProps {
  munId: string;
  /** The option this field belongs to — needed for create, and for the copy. */
  optionId: string;
  optionName: string;
  /** Omit to create; supply to edit that field. */
  field?: FieldRow;
  /** Suggested `displayOrder` for a new field: one past the current last. */
  nextDisplayOrder: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccommodationFieldDialog({
  munId,
  optionId,
  optionName,
  field,
  nextDisplayOrder,
  open,
  onOpenChange,
}: AccommodationFieldDialogProps) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const isEdit = field !== undefined;

  const [fieldType, setFieldType] = React.useState<AccommodationFieldType>(
    field?.fieldType ?? "TEXT",
  );
  const [choices, setChoices] = React.useState<string[]>(field?.choices ?? []);
  const [required, setRequired] = React.useState<boolean>(
    field?.required ?? false,
  );

  const needsChoices = isChoiceFieldType(fieldType);
  const fieldId = React.useId();

  /*
    NO "clear the error when the dialog reopens" effect here, unlike
    `accommodation-option-dialog.tsx`. This component is only MOUNTED while
    open, and its caller keys it on the field id (see `accommodation-table.tsx`),
    so every open is a fresh mount and `useState(null)` above has already
    cleared the error. An effect would be a redundant second render that
    `react-hooks/set-state-in-effect` correctly flags.
  */

  function handleSubmit(formData: FormData) {
    const values: FieldFormValues = {
      fieldType,
      label: String(formData.get("label") ?? ""),
      required,
      // Non-choice types submit an empty list; `normaliseField` on the server
      // drops it regardless, so a type switched away from DROPDOWN can't leave
      // orphaned options behind.
      choices: needsChoices ? choices : [],
      displayOrder: toIntOrNaN(formData.get("displayOrder")),
    };

    // Client-side mirror of the backend's own throw condition
    // (`createAccommodationOptionField` throws "Field type X requires at least
    // one choice"). Caught here so the organizer gets an inline message next to
    // the editor they need to fix, rather than a round trip that surfaces a
    // backend error string in a toast.
    if (needsChoices && values.choices.every((choice) => !choice.trim())) {
      setError(
        `A ${fieldType === "DROPDOWN" ? "dropdown" : "checkbox"} field needs at least one choice. Add one below.`,
      );
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateFieldAction(munId, field.id, values)
        : await createFieldAction(munId, optionId, values);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onOpenChange(false);
      toast.success(
        isEdit ? `${result.data.label} updated` : `${result.data.label} added`,
        {
          description: isEdit
            ? `Changes are live on ${optionName}.`
            : `Delegates booking ${optionName} will be asked this.`,
        },
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit field" : "New field"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `A question delegates answer when booking ${optionName}.`
              : `Ask delegates booking ${optionName} for something extra — meal preference, arrival date, roommate request.`}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="flex flex-col gap-md">
          <Field
            id={`${fieldId}-label`}
            label="Question label"
            hint="Phrase it as the delegate will read it."
          >
            <Input
              id={`${fieldId}-label`}
              name="label"
              required
              maxLength={200}
              disabled={pending}
              defaultValue={field?.label ?? ""}
              placeholder="Meal preference"
              autoComplete="off"
            />
          </Field>

          <div className="grid gap-md sm:grid-cols-[1fr_8rem]">
            <Field
              id={`${fieldId}-type`}
              label="Answer type"
              hint={
                FIELD_TYPE_OPTIONS.find((option) => option.value === fieldType)
                  ?.hint
              }
            >
              <select
                id={`${fieldId}-type`}
                name="fieldType"
                disabled={pending}
                value={fieldType}
                onChange={(event) =>
                  setFieldType(event.target.value as AccommodationFieldType)
                }
                className={selectClassName}
                style={{ backgroundImage: `url("${CHEVRON_SVG}")` }}
              >
                {FIELD_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id={`${fieldId}-order`}
              label="Order"
              hint="Lower shows first."
            >
              <Input
                id={`${fieldId}-order`}
                name="displayOrder"
                type="number"
                inputMode="numeric"
                min={0}
                max={10_000}
                step={1}
                required
                disabled={pending}
                defaultValue={field?.displayOrder ?? nextDisplayOrder}
              />
            </Field>
          </div>

          {/*
            Only rendered for DROPDOWN / CHECKBOX. Unmounting (rather than
            hiding) keeps the choices out of the tab order and off the a11y tree
            when they're meaningless for the selected type.
          */}
          {needsChoices && (
            <ChoicesEditor
              choices={choices}
              onChange={setChoices}
              disabled={pending}
              fieldType={fieldType}
            />
          )}

          <label className="flex items-start gap-xs">
            <Checkbox
              name="required"
              checked={required}
              onCheckedChange={(value) => setRequired(value === true)}
              disabled={pending}
              className="mt-px"
            />
            <span className="flex flex-col gap-xxs">
              <span className="text-body-md font-medium text-ink">
                Required
              </span>
              <span className="text-[12px] leading-[1.35] text-muted-foreground">
                Delegates can&rsquo;t complete their booking without answering.
              </span>
            </span>
          </label>

          {error && (
            <p
              role="alert"
              className="rounded-sm border border-destructive/30 bg-destructive/10 px-sm py-xs text-body-md text-destructive-text"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : isEdit ? (
                <CheckIcon aria-hidden />
              ) : (
                <PlusIcon aria-hidden />
              )}
              {pending ? "Saving…" : isEdit ? "Save changes" : "Add field"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toIntOrNaN(value: FormDataEntryValue | null): number {
  const raw = String(value ?? "").trim();
  if (!raw) return Number.NaN;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

// ---------------------------------------------------------------------------
// Choices editor
// ---------------------------------------------------------------------------

interface ChoicesEditorProps {
  choices: string[];
  onChange: (choices: string[]) => void;
  disabled: boolean;
  fieldType: AccommodationFieldType;
}

/**
 * The add/remove choice list for DROPDOWN and CHECKBOX fields.
 *
 * Each existing choice is an editable row rather than a static chip: a typo in
 * "Vegeterian" should be fixable in place, not require delete-and-retype. Rows
 * are keyed by INDEX deliberately — the choices are plain strings with no
 * stable identity, and keying by value would remount an input on every
 * keystroke (destroying focus and the caret position mid-word).
 *
 * A new choice is staged in its own input and committed on Enter or the Add
 * button. Enter is intercepted with `preventDefault` because inside a `<form>`
 * it would otherwise submit the whole dialog — the single most likely way an
 * organizer would half-create a field while trying to add their second choice.
 */
function ChoicesEditor({
  choices,
  onChange,
  disabled,
  fieldType,
}: ChoicesEditorProps) {
  const [draft, setDraft] = React.useState("");
  const fieldId = React.useId();
  const listId = `${fieldId}-list`;

  const trimmedDraft = draft.trim();
  const duplicate =
    trimmedDraft.length > 0 &&
    choices.some(
      (choice) => choice.trim().toLowerCase() === trimmedDraft.toLowerCase(),
    );
  const canAdd = trimmedDraft.length > 0 && !duplicate && choices.length < 100;

  function addChoice() {
    if (!canAdd) return;
    onChange([...choices, trimmedDraft]);
    setDraft("");
  }

  function updateChoice(index: number, value: string) {
    onChange(choices.map((choice, i) => (i === index ? value : choice)));
  }

  function removeChoice(index: number) {
    onChange(choices.filter((_, i) => i !== index));
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-xs rounded-md border border-border bg-surface-soft p-md dark:bg-muted/20">
      <legend className="px-xxs text-body-md font-medium text-ink">
        {fieldType === "DROPDOWN" ? "Dropdown choices" : "Checkbox choices"}
      </legend>

      <p className="text-[12px] leading-[1.35] text-muted-foreground">
        At least one is required.{" "}
        {fieldType === "DROPDOWN"
          ? "Delegates pick exactly one."
          : "Delegates can pick several."}
      </p>

      {choices.length > 0 && (
        <ul id={listId} className="flex flex-col gap-xs">
          {choices.map((choice, index) => (
            // Keyed by INDEX deliberately — see this component's header. The
            // choices are plain strings with no stable identity, and keying by
            // value would remount the input on every keystroke, destroying
            // focus and caret position mid-word.
            <li key={index} className="flex items-center gap-xs">
              <Input
                aria-label={`Choice ${index + 1}`}
                value={choice}
                maxLength={200}
                disabled={disabled}
                onChange={(event) => updateChoice(index, event.target.value)}
                className="h-9"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                onClick={() => removeChoice(index)}
                className="shrink-0 text-destructive-text! hover:bg-destructive/10"
                aria-label={`Remove choice ${choice || index + 1}`}
              >
                <XIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-start gap-xs">
        <div className="flex min-w-0 flex-1 flex-col gap-xxs">
          <Input
            aria-label="New choice"
            value={draft}
            maxLength={200}
            disabled={disabled || choices.length >= 100}
            placeholder={choices.length === 0 ? "Vegetarian" : "Add another…"}
            autoComplete="off"
            aria-invalid={duplicate || undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              // Enter inside a form submits it. Here it means "commit this
              // choice" — never "save the field with a half-typed choice".
              event.preventDefault();
              addChoice();
            }}
            className="h-9"
          />
          {duplicate && (
            <p role="alert" className="text-[12px] leading-[1.35] text-destructive-text">
              That choice is already in the list.
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !canAdd}
          onClick={addChoice}
        >
          <PlusIcon aria-hidden />
          Add
        </Button>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div className="flex min-w-0 flex-col gap-xs">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p className="text-[12px] leading-[1.35] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
