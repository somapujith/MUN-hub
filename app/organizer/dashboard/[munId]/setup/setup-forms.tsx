"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import {
  SetupField,
  SetupSection,
  SetupTextarea,
  toDateInputValue,
} from "./setup-field";
import {
  saveDatesVenueAction,
  saveGeneralAction,
  type SetupFormState,
} from "./actions";

/**
 * The two real MUN Setup tabs (PRD § 9 General, Dates, Venue).
 *
 * Both are the same shape — an uncontrolled form posting to a bound server
 * action via `useActionState` — so the plumbing lives in `<SetupForm>` and each
 * tab supplies only its fields. What that shared shell owns:
 *
 *   - Binding `munId` into the action. `.bind(null, munId)` puts it in the
 *     action's closure rather than a hidden input, so it isn't editable from
 *     devtools. (It wouldn't matter if it were — `assertOwnsOrAdmin` re-checks
 *     server-side — but not offering the handle is still the right default.)
 *   - The remount key. See the `generation` note below.
 *   - Error alert + toast, and the success toast.
 */

const EMPTY_STATE: SetupFormState = { status: "idle" };

function SaveButton({ label = "Save changes" }: { label?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending && <LoaderCircleIcon aria-hidden className="animate-spin" />}
      {pending ? "Saving…" : label}
    </Button>
  );
}

interface SetupFormProps {
  action: (
    munId: string,
    prev: SetupFormState,
    formData: FormData,
  ) => Promise<SetupFormState>;
  munId: string;
  /** Receives `errors` and `values`, both already defaulted to `{}`. */
  children: (ctx: {
    errors: Record<string, string>;
    values: Record<string, string>;
  }) => React.ReactNode;
}

function SetupForm({ action, munId, children }: SetupFormProps) {
  const boundAction = React.useMemo(() => action.bind(null, munId), [action, munId]);
  const [state, formAction] = useActionState<SetupFormState, FormData>(
    boundAction,
    EMPTY_STATE,
  );

  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};

  /**
   * Remount key for the field subtree.
   *
   * Every field below is uncontrolled, seeded from `defaultValue`. Two events
   * change what that seed should be after mount:
   *
   *   1. The first failed submit, which hands back `state.values` (what the
   *      user typed) so their input survives.
   *   2. A successful save, which bumps `savedAt` — the fields should re-seed
   *      from the freshly-revalidated server props, not keep whatever the last
   *      error echo put there.
   *
   * `defaultValue` is read once at mount by design; mutating it on a live
   * input is exactly what trips Base UI's "changing an uncontrolled
   * FieldControl after init" warning (the bug already fixed once in
   * `app/organizer/apply/apply-form.tsx`). Keying the subtree makes React
   * remount with the new seed baked into the initial render instead.
   *
   * The key is derived, not a counter: `savedAt` for a save, a stable marker
   * for the first error echo. It only changes when the seed genuinely changes,
   * so typing into a field never blows away the field.
   */
  const sawValues = React.useRef(false);
  if (state.values) sawValues.current = true;
  const fieldKey = `${state.savedAt ?? 0}-${sawValues.current ? 1 : 0}`;

  // Toasts mirror the inline alert for a user whose focus is mid-form and who
  // would otherwise never see a message rendered at the top of the panel.
  const lastToast = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    const signature = `${state.status}:${state.savedAt ?? ""}:${state.message ?? ""}`;
    if (state.status === "idle" || signature === lastToast.current) return;
    lastToast.current = signature;

    if (state.status === "error" && state.message) toast.error(state.message);
    if (state.status === "success" && state.message) toast.success(state.message);
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
          <TriangleAlertIcon
            aria-hidden
            strokeWidth={1.75}
            className="mt-px size-4 shrink-0"
          />
          <p>{state.message}</p>
        </div>
      )}

      <React.Fragment key={fieldKey}>{children({ errors, values })}</React.Fragment>

      <div className="flex flex-wrap items-center justify-end gap-sm border-t border-border pt-lg">
        {/* `aria-live` rather than `role="status"` on a conditional node: the
            region has to be in the DOM before the message arrives for a screen
            reader to announce it. */}
        <p aria-live="polite" className="mr-auto text-body-md text-muted-foreground">
          {state.status === "success" && state.message && (
            <span className="inline-flex items-center gap-xs text-success-text">
              <CheckIcon aria-hidden strokeWidth={2} className="size-3.5" />
              {state.message}
            </span>
          )}
        </p>
        <SaveButton />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

export interface GeneralFormProps {
  munId: string;
  name: string;
  edition: string | null;
  theme: string | null;
  description: string | null;
}

export function GeneralForm({ munId, name, edition, theme, description }: GeneralFormProps) {
  return (
    <SetupForm action={saveGeneralAction} munId={munId}>
      {({ errors, values }) => (
        <>
          <SetupSection
            title="Identity"
            description="How your conference is named across the marketplace and every delegate-facing page."
          >
            <SetupField
              name="name"
              label="Conference name"
              required
              maxLength={200}
              placeholder="Oxford MUN 2027"
              hint="Shown as your listing title. Changing it does not change your public web address."
              error={errors.name}
              defaultValue={values.name ?? name}
            />
            <SetupField
              name="edition"
              label="Edition"
              placeholder="12th edition"
              hint="Which run of the conference this is, if you number them."
              error={errors.edition}
              defaultValue={values.edition ?? edition ?? ""}
            />
          </SetupSection>

          <SetupSection
            title="Positioning"
            description="The pitch a delegate reads before deciding to register."
          >
            <SetupField
              name="theme"
              label="Theme"
              placeholder="Diplomacy in a fragmented world"
              hint="One line. Appears under your conference name on the listing."
              error={errors.theme}
              defaultValue={values.theme ?? theme ?? ""}
            />
            <SetupField
              name="description"
              label="About this conference"
              hint="Agenda focus, who it's for, what makes it worth attending."
              error={errors.description}
              defaultValue={values.description ?? description ?? ""}
            >
              {(props) => (
                <SetupTextarea
                  {...props}
                  rows={7}
                  placeholder="A four-day conference for high-school delegates across six committees, focused on climate finance and humanitarian response…"
                />
              )}
            </SetupField>
          </SetupSection>
        </>
      )}
    </SetupForm>
  );
}

// ---------------------------------------------------------------------------
// Dates & venue
// ---------------------------------------------------------------------------

export interface DatesVenueFormProps {
  munId: string;
  startDate: Date | null;
  endDate: Date | null;
  venue: string | null;
  city: string | null;
  country: string | null;
}

export function DatesVenueForm({
  munId,
  startDate,
  endDate,
  venue,
  city,
  country,
}: DatesVenueFormProps) {
  return (
    <SetupForm action={saveDatesVenueAction} munId={munId}>
      {({ errors, values }) => (
        <>
          <SetupSection
            title="Dates"
            description="When the conference itself runs. Registration deadlines are set per pass under Registration Products."
          >
            <div className="grid gap-lg sm:grid-cols-2">
              <SetupField
                name="startDate"
                label="Start date"
                type="date"
                error={errors.startDate}
                defaultValue={values.startDate ?? toDateInputValue(startDate)}
              />
              <SetupField
                name="endDate"
                label="End date"
                type="date"
                error={errors.endDate}
                defaultValue={values.endDate ?? toDateInputValue(endDate)}
              />
            </div>
          </SetupSection>

          <SetupSection
            title="Venue"
            description="Where delegates are physically going. Used for the listing's location filter."
          >
            <SetupField
              name="venue"
              label="Venue"
              placeholder="Examination Schools, High Street"
              hint="Building or campus name, and street if you have one."
              error={errors.venue}
              defaultValue={values.venue ?? venue ?? ""}
            />
            <div className="grid gap-lg sm:grid-cols-2">
              <SetupField
                name="city"
                label="City"
                placeholder="Oxford"
                error={errors.city}
                defaultValue={values.city ?? city ?? ""}
              />
              <SetupField
                name="country"
                label="Country"
                placeholder="United Kingdom"
                error={errors.country}
                defaultValue={values.country ?? country ?? ""}
              />
            </div>
          </SetupSection>
        </>
      )}
    </SetupForm>
  );
}
