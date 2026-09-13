"use client";

import * as React from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";

/**
 * Field / fieldset primitives shared by the two real Setup tabs.
 *
 * Deliberately a near-copy of the pattern in `app/organizer/apply/apply-form.tsx`
 * rather than an import from it: that file's `Field` is private to the public
 * application funnel and tuned for it (a tall, one-shot, marketing-adjacent
 * form). The workspace wants the same semantics — label + hint + inline error,
 * `aria-invalid` and `aria-describedby` wired — at workspace density. Sharing
 * one component across both would have meant a `variant` prop threading two
 * unrelated layouts through a single tree.
 *
 * If a third caller appears, promote this file to `components/organizer/` and
 * have `apply-form.tsx` consume it too.
 */

export interface SetupFieldProps {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  defaultValue?: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  /** Render prop for non-`<Input>` controls (textarea, select). */
  children?: (props: {
    id: string;
    name: string;
    defaultValue: string;
    required?: boolean;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
  }) => React.ReactNode;
}

export function SetupField({
  name,
  label,
  hint,
  error,
  defaultValue,
  required,
  children,
  ...inputProps
}: SetupFieldProps) {
  const id = `setup-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  const controlProps = {
    id,
    name,
    // Never `undefined`: flipping an uncontrolled field's `defaultValue` from
    // undefined to a string on a re-render is the uncontrolled -> controlled
    // switch Base UI warns about.
    defaultValue: defaultValue ?? "",
    required,
    "aria-invalid": Boolean(error),
    "aria-describedby": describedBy,
  } as const;

  return (
    <div className="flex flex-col gap-xs">
      <Label htmlFor={id}>
        {label}
        {!required && (
          <span className="text-body-md font-normal text-muted-foreground">Optional</span>
        )}
      </Label>

      {children ? children(controlProps) : <Input {...controlProps} {...inputProps} />}

      {/* Hint before error: the hint explains the field, the error reacts to
          what was typed, so the error is the last thing read before moving on. */}
      {hint && (
        <p id={hintId} className="text-body-md text-pretty text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          className="flex items-start gap-xs text-body-md text-destructive-text"
        >
          <TriangleAlertIcon
            aria-hidden
            strokeWidth={1.75}
            className="mt-px size-3.5 shrink-0"
          />
          {error}
        </p>
      )}
    </div>
  );
}

/** Multi-line control, styled to match `<Input>`'s token set. */
export function SetupTextarea({
  rows = 6,
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm",
        "text-base text-ink transition-colors outline-none md:text-body-md",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        "dark:bg-card",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A labelled group inside a tab panel. Two-column at `md`: description rail on
 * the left, controls on the right — the same rhythm as the apply form, which
 * keeps a long settings surface scannable by group rather than by field.
 */
export function SetupSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-lg md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-xl">
      <legend className="sr-only">{title}</legend>
      <div className="flex flex-col gap-xxs">
        {/* aria-hidden: `<legend>` already names the group for assistive tech,
            so announcing this heading too would read the title twice. */}
        <h2 aria-hidden className="font-display text-title-sm text-ink">
          {title}
        </h2>
        <p className="text-body-md text-pretty text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-lg">{children}</div>
    </fieldset>
  );
}

/** `Date` -> `<input type="date">` value, on the same UTC basis it was stored. */
export function toDateInputValue(date: Date | string | null | undefined): string {
  if (!date) return "";
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}
