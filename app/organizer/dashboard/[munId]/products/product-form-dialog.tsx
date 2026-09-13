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
  createProductAction,
  updateProductAction,
  type ProductFormValues,
} from "./actions";
import type { ProductRow } from "./queries";

/**
 * The create/edit form for a registration product, in a dialog.
 *
 * ONE component for both modes rather than two near-identical ones: the field
 * set is identical and the only differences are the submit target, the copy,
 * and whether the inputs start populated. Splitting it would guarantee the two
 * copies drift on the next field added.
 *
 * The inputs are UNCONTROLLED (`defaultValue`) and the whole dialog body is
 * remounted via `key` on the product id whenever the edit target changes — see
 * the `key` on `<ProductFormFields>` below. An uncontrolled input ignores a
 * `defaultValue` that changes after mount, so without that key, opening the
 * edit dialog on product A and then on product B would show A's values in B's
 * form. Controlled state would also work but would mean a `useEffect` sync on
 * every open, which is the same bug with more moving parts.
 */

/** Currencies the platform prices in today. Free text would invite typos. */
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;

/**
 * A native `<select>` styled to match `<Input>`. Kept as a constant rather than
 * an arbitrary Tailwind class on the element because the chevron is an inline
 * SVG data URI, and its `>` characters terminate the JSX tag when written in a
 * className attribute. `appearance-none` plus a background image is the only
 * way to get a consistent chevron across Safari/Firefox/Chrome.
 */
const CHEVRON_SVG =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2341454d' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E";

const selectClassName = cn(
  "h-11 w-full min-w-0 cursor-pointer appearance-none rounded-sm border border-input bg-background bg-[length:14px] bg-[right_12px_center] bg-no-repeat px-md py-sm pr-8 text-body-md text-ink transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:border-border-strong disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card",
);

/** `Date` -> `yyyy-MM-dd` in LOCAL time, the inverse of `parseDeadline`. */
function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface ProductFormDialogProps {
  munId: string;
  /** Omit to create; supply to edit that product. */
  product?: ProductRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductFormDialog({
  munId,
  product,
  open,
  onOpenChange,
}: ProductFormDialogProps) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const isEdit = product !== undefined;

  // Clear a stale inline error when the dialog is reopened — otherwise a failed
  // save leaves its red banner sitting above a fresh, untouched form.
  React.useEffect(() => {
    if (open) setError(null);
  }, [open, product?.id]);

  function handleSubmit(formData: FormData) {
    const values: ProductFormValues = {
      name: String(formData.get("name") ?? ""),
      // `Number("")` is 0, which would silently create a free product from a
      // blank field. Empty maps to NaN so `validate` rejects it.
      price: toIntOrNaN(formData.get("price")),
      capacity: toIntOrNaN(formData.get("capacity")),
      currency: String(formData.get("currency") ?? "INR"),
      deadline: String(formData.get("deadline") ?? ""),
    };

    setError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateProductAction(munId, product.id, values)
        : await createProductAction(munId, values);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onOpenChange(false);
      toast.success(
        isEdit ? `${result.data.name} updated` : `${result.data.name} created`,
        {
          description: isEdit
            ? "Changes are live for anyone viewing this conference."
            : "The pass is now available on the registration page.",
        },
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit registration product" : "New registration product"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Price and capacity changes apply immediately. Reducing capacity below seats already taken won't cancel anyone — it just stops new sales."
              : "A pass delegates can buy — Delegate, Press, Observer, or anything else you sell a seat for."}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="flex flex-col gap-md">
          {/*
            `key` remounts every field when the edit target changes, which is
            what makes `defaultValue` correct on a reused dialog instance.
          */}
          <ProductFormFields
            key={product?.id ?? "new"}
            product={product}
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
              {pending
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Create product"}
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

interface ProductFormFieldsProps {
  product?: ProductRow;
  disabled: boolean;
}

function ProductFormFields({ product, disabled }: ProductFormFieldsProps) {
  const fieldId = React.useId();

  return (
    <>
      <Field
        id={`${fieldId}-name`}
        label="Product name"
        hint="What delegates see on the registration page."
      >
        <Input
          id={`${fieldId}-name`}
          name="name"
          required
          maxLength={120}
          disabled={disabled}
          defaultValue={product?.name ?? ""}
          placeholder="Delegate"
          autoComplete="off"
        />
      </Field>

      <div className="grid gap-md sm:grid-cols-[1fr_7.5rem]">
        <Field
          id={`${fieldId}-price`}
          label="Price"
          hint="Whole units, no decimals. Enter 0 for a free pass."
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
            defaultValue={product?.price ?? ""}
            placeholder="1500"
          />
        </Field>

        <Field id={`${fieldId}-currency`} label="Currency">
          {/*
            A native <select> rather than the Base UI Select: this sits inside a
            dialog, and a portalled listbox layered over a portalled dialog is a
            focus-trap fight for six static options. The styling matches Input
            deliberately so the row still reads as one control pair.
          */}
          <select
            id={`${fieldId}-currency`}
            name="currency"
            disabled={disabled}
            defaultValue={product?.currency ?? "INR"}
            className={selectClassName}
            style={{ backgroundImage: `url("${CHEVRON_SVG}")` }}
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-md sm:grid-cols-2">
        <Field
          id={`${fieldId}-capacity`}
          label="Capacity"
          hint="Total seats for this pass."
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
            defaultValue={product?.capacity ?? ""}
            placeholder="200"
          />
        </Field>

        <Field
          id={`${fieldId}-deadline`}
          label="Deadline"
          hint="Optional. Closes at end of day."
        >
          <Input
            id={`${fieldId}-deadline`}
            name="deadline"
            type="date"
            disabled={disabled}
            defaultValue={toDateInputValue(product?.deadline ?? null)}
          />
        </Field>
      </div>
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
