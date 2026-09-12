"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";
import { submitApplicationAction, type ApplyFormState } from "./actions";

// Lives here, not in `actions.ts`: a "use server" module may only export async
// functions — exporting a plain object constant from it is a runtime 500.
const EMPTY_APPLY_STATE: ApplyFormState = { status: "idle" };

/**
 * Organizer application form — a transactional surface, not a marketing one.
 * Calm white canvas, `text-input` fields, sectioned into three labelled
 * fieldsets so a 7-field form reads as three short steps rather than one wall.
 *
 * Errors are returned as state (never a redirect) so the user's input survives
 * a failed submit; each invalid field gets `aria-invalid` + an
 * `aria-describedby` message, and the summary is also announced via a toast.
 */

interface FieldProps {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  defaultValue?: string;
  required?: boolean;
  children?: (props: {
    id: string;
    name: string;
    defaultValue: string;
    required?: boolean;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
  }) => React.ReactNode;
  type?: string;
  placeholder?: string;
  min?: string;
  inputMode?: "numeric" | "text";
}

function Field({
  name,
  label,
  hint,
  error,
  defaultValue,
  required,
  children,
  ...inputProps
}: FieldProps) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  const controlProps = {
    id,
    name,
    // Always a string, never undefined: flipping an uncontrolled field's
    // defaultValue from undefined to a value on the error re-render makes
    // Base UI warn about an uncontrolled->controlled switch.
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

      {/* Hint first, then error: the hint explains the field, the error
          reacts to what was typed, so the error should be the last thing
          read before the next control. */}
      {hint && (
        <p id={hintId} className="text-body-md text-muted-foreground text-pretty">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-xs text-body-md text-destructive-text">
          <TriangleAlertIcon aria-hidden strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-lg border-t border-border pt-xl md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-xl">
      <legend className="sr-only">{title}</legend>
      <div className="flex flex-col gap-xxs">
        <h2 aria-hidden className="font-display text-title-sm text-ink">
          {title}
        </h2>
        <p className="text-body-md text-muted-foreground text-pretty">{description}</p>
      </div>
      <div className="flex flex-col gap-lg">{children}</div>
    </fieldset>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
      {pending && <LoaderCircleIcon aria-hidden className="animate-spin" />}
      {pending ? "Submitting…" : "Submit application"}
    </Button>
  );
}

export function ApplyForm() {
  const [state, formAction] = useActionState<ApplyFormState, FormData>(
    submitApplicationAction,
    EMPTY_APPLY_STATE,
  );

  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};

  // Every field below is a plain uncontrolled input keyed by `defaultValue`.
  // The first failed submit hands them non-empty `values` for the first
  // time — going from `defaultValue=""` to `defaultValue="what I typed"` on
  // an *already-mounted* input is exactly what trips Base UI's "changing an
  // uncontrolled FieldControl after init" warning (defaultValue is meant to
  // be read once, at mount). `generation` flips from 0 to 1 the first time
  // `state.values` shows up and never again, so it can key the whole field
  // block: React remounts every field fresh with the server-echoed value
  // already baked into its initial render, instead of mutating a live one.
  const generation = React.useRef(0);
  const sawValues = React.useRef(false);
  if (state.values && !sawValues.current) {
    sawValues.current = true;
    generation.current += 1;
  }

  // Toast mirrors the inline alert for users whose focus is mid-form and who
  // would otherwise miss the summary that renders at the top.
  const lastMessage = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (state.status === "error" && state.message && state.message !== lastMessage.current) {
      lastMessage.current = state.message;
      toast.error(state.message);
    }
    if (state.status !== "error") lastMessage.current = undefined;
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-xl" noValidate>
      {state.status === "error" && state.message && (
        <div
          role="alert"
          className={cn(
            "flex items-start gap-sm rounded-md border border-destructive/30 bg-destructive/10 p-md",
            "text-body-md text-destructive-text",
          )}
        >
          <TriangleAlertIcon aria-hidden strokeWidth={1.75} className="mt-px size-4 shrink-0" />
          <p>{state.message}</p>
        </div>
      )}

      {/*
        Keyed on `generation`: this whole subtree remounts fresh exactly once,
        the render where server-echoed `values` first appears, instead of
        each field's `defaultValue` prop mutating on a live instance (see the
        comment above `generation` for why that matters).
      */}
      <React.Fragment key={generation.current}>
        <Section
          title="Your conference"
          description="What you're planning to run, and where delegates will gather."
        >
          <Field
            name="conferenceName"
            label="Conference name"
            required
            placeholder="Oxford MUN 2027"
            hint="This becomes your public listing title and page address."
            error={errors.conferenceName}
            defaultValue={values.conferenceName}
          />
          <div className="grid gap-lg sm:grid-cols-2">
            <Field
              name="location"
              label="Host city"
              required
              placeholder="Bengaluru"
              error={errors.location}
              defaultValue={values.location}
            />
            <Field
              name="expectedDate"
              label="Expected start date"
              type="date"
              required
              error={errors.expectedDate}
              defaultValue={values.expectedDate}
            />
          </div>
        </Section>

        <Section
          title="Scale"
          description="A rough figure is fine — it helps us size your review."
        >
          <Field
            name="expectedDelegateCount"
            label="Expected delegates"
            type="number"
            inputMode="numeric"
            min="1"
            required
            placeholder="250"
            hint="Total across every committee."
            error={errors.expectedDelegateCount}
            defaultValue={values.expectedDelegateCount}
          />
        </Section>

        <Section
          title="Context"
          description="Give our review team enough to understand your conference."
        >
          <Field
            name="description"
            label="About the conference"
            required
            hint="Agenda focus, committees you're planning, who it's for. Minimum 40 characters."
            error={errors.description}
            defaultValue={values.description}
          >
            {(props) => (
              <textarea
                {...props}
                rows={6}
                placeholder="A four-day conference for high-school delegates across six committees, focused on climate finance and humanitarian response…"
                className={cn(
                  "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm",
                  "text-base text-ink transition-colors outline-none md:text-body-md",
                  "placeholder:text-muted-foreground",
                  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
                  "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
                  "dark:bg-card",
                )}
              />
            )}
          </Field>

          <div className="grid gap-lg sm:grid-cols-2">
            <Field
              name="previousEditions"
              label="Previous editions"
              placeholder="3 editions since 2024"
              error={errors.previousEditions}
              defaultValue={values.previousEditions}
            />
            <Field
              name="websiteUrl"
              label="Website"
              type="url"
              placeholder="https://example.org"
              error={errors.websiteUrl}
              defaultValue={values.websiteUrl}
            />
          </div>
        </Section>
      </React.Fragment>

      <div className="flex flex-col gap-sm border-t border-border pt-xl sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-md text-muted-foreground text-pretty">
          Our team reviews applications within 5 business days.
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}
