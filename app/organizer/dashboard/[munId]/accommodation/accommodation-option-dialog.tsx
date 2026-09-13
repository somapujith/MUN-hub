"use client";

import * as React from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { CheckIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  createOptionAction,
  updateOptionAction,
  type OptionFormValues,
} from "./actions";
import type { AccommodationOptionRow } from "./queries";

/**
 * The create/edit form for an accommodation option, in a dialog.
 *
 * ONE component for both modes rather than two near-identical ones — the field
 * set is identical and only the submit target, the copy, and whether the inputs
 * start populated differ. Mirrors `products/product-form-dialog.tsx`.
 *
 * The inputs are UNCONTROLLED (`defaultValue`) and the body is remounted via
 * `key` on the option id whenever the edit target changes. An uncontrolled
 * input IGNORES a `defaultValue` that changes after mount, so without that key,
 * opening edit on option A then option B would show A's values inside B's form.
 */

/**
 * A `<textarea>` styled to match `<Input>`. There is no Textarea primitive in
 * `components/ui`, and the description is the one genuinely multi-line field
 * here ("Twin-sharing AC room, breakfast included, 2 min from venue"). Squeezing
 * it into a single-line Input would hide the tail of the text the delegate sees.
 * Height is `min-h` + `resize-y` rather than fixed so long copy stays readable.
 */
const textareaClassName = cn(
  "min-h-24 w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm text-base text-ink transition-colors outline-none md:text-body-md",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card",
);

interface AccommodationOptionDialogProps {
  munId: string;
  /** Omit to create; supply to edit that option. */
  option?: AccommodationOptionRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccommodationOptionDialog({
  munId,
  option,
  open,
  onOpenChange,
}: AccommodationOptionDialogProps) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const isEdit = option !== undefined;

  /*
    Clear a stale inline error when the dialog is reopened — otherwise a failed
    save leaves its red banner above a fresh, untouched form.

    Done with the render-phase "adjust state on prop change" pattern React
    documents (https://react.dev/learn/you-might-not-need-an-effect), NOT a
    `useEffect`. This component stays MOUNTED while closed (the table always
    renders it), so the reset has to be driven by the open/target transition
    rather than by mounting. An effect doing the same thing renders once with
    the stale error still painted, then again to clear it — which is exactly
    what `react-hooks/set-state-in-effect` flags. Comparing against the previous
    value during render clears it before anything is shown.
  */
  const target = open ? (option?.id ?? "new") : null;
  const [lastTarget, setLastTarget] = React.useState(target);
  if (target !== lastTarget) {
    setLastTarget(target);
    setError(null);
  }

  function handleSubmit(formData: FormData) {
    const values: OptionFormValues = {
      name: String(formData.get("name") ?? ""),
      // `Number("")` is 0, which would silently create a free option from a
      // blank field. Empty maps to NaN so `validateOption` rejects it.
      price: toIntOrNaN(formData.get("price")),
      capacity: toIntOrNaN(formData.get("capacity")),
      description: String(formData.get("description") ?? ""),
    };

    setError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateOptionAction(munId, option.id, values)
        : await createOptionAction(munId, values);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onOpenChange(false);
      toast.success(
        isEdit ? `${result.data.name} updated` : `${result.data.name} created`,
        {
          description: isEdit
            ? "Changes are live for anyone registering."
            : "Add any custom fields it needs, then it's ready to book.",
        },
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit accommodation option" : "New accommodation option"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Price and capacity changes apply immediately. Reducing capacity below beds already booked won't cancel anyone — it just stops new bookings."
              : "A stay delegates can add to their registration — a hostel bed, a twin-sharing room, or anything else you charge for."}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="flex flex-col gap-md">
          {/*
            `key` remounts every field when the edit target changes, which is
            what makes `defaultValue` correct on a reused dialog instance.
          */}
          <OptionFormFields
            key={option?.id ?? "new"}
            option={option}
            disabled={pending}
          />

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
              {pending ? "Saving…" : isEdit ? "Save changes" : "Create option"}
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

interface OptionFormFieldsProps {
  option?: AccommodationOptionRow;
  disabled: boolean;
}

function OptionFormFields({ option, disabled }: OptionFormFieldsProps) {
  const fieldId = React.useId();

  return (
    <>
      <Field
        id={`${fieldId}-name`}
        label="Option name"
        hint="What delegates see when choosing a stay."
      >
        <Input
          id={`${fieldId}-name`}
          name="name"
          required
          maxLength={120}
          disabled={disabled}
          defaultValue={option?.name ?? ""}
          placeholder="Twin-sharing AC room"
          autoComplete="off"
        />
      </Field>

      <div className="grid gap-md sm:grid-cols-2">
        <Field
          id={`${fieldId}-price`}
          label="Price"
          hint="Whole rupees, no decimals. Enter 0 if it's included."
        >
          <Input
            id={`${fieldId}-price`}
            name="price"
            type="number"
            inputMode="numeric"
            min={0}
            max={10_000_000}
            step={1}
            required
            disabled={disabled}
            defaultValue={option?.price ?? ""}
            placeholder="2500"
          />
        </Field>

        <Field
          id={`${fieldId}-capacity`}
          label="Capacity"
          hint="Total beds available."
        >
          <Input
            id={`${fieldId}-capacity`}
            name="capacity"
            type="number"
            inputMode="numeric"
            min={1}
            max={100_000}
            step={1}
            required
            disabled={disabled}
            defaultValue={option?.capacity ?? ""}
            placeholder="60"
          />
        </Field>
      </div>

      <Field
        id={`${fieldId}-description`}
        label="Description"
        hint="Optional. What's included, how far from the venue, check-in times."
      >
        <textarea
          id={`${fieldId}-description`}
          name="description"
          rows={3}
          maxLength={1000}
          disabled={disabled}
          defaultValue={option?.description ?? ""}
          placeholder="Twin-sharing AC room with breakfast, 2 minutes from the venue. Check-in from 2 PM."
          className={textareaClassName}
        />
      </Field>
    </>
  );
}

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
