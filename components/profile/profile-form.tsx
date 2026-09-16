"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2Icon, SaveIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveProfileAction, type ProfileFormState } from "@/app/profile/actions";

export interface ProfileFormDefaults {
  phone: string;
  institution: string;
  dateOfBirth: string;
  gradeOrYear: string;
  residentialAddress: string;
  requiresTransportation: boolean;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  munExperience: string;
  referralCode: string;
}

interface ProfileFormProps {
  defaults: ProfileFormDefaults;
  /** Where to send the student after a successful save; "/dashboard" if none. */
  redirectTo: string;
}

const initialState: ProfileFormState = { status: "idle" };

/** Copied from `components/registration/registration-form.tsx`'s `selectClassName` — not reinvented. */
const selectClassName = cn(
  "h-11 w-full rounded-sm border border-input bg-background px-md text-body-md text-ink transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card",
);

/** Same visual treatment as `Input`, for the two long-text fields. */
const textareaClassName = cn(
  "w-full min-w-0 rounded-sm border border-input bg-background px-md py-sm text-base text-ink transition-colors outline-none md:text-body-md",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-surface-soft disabled:text-muted-foreground",
  "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
  "dark:bg-card",
);

export function ProfileForm({ defaults, redirectTo }: ProfileFormProps) {
  const [state, formAction] = useActionState(saveProfileAction, initialState);
  const alertRef = React.useRef<HTMLDivElement>(null);

  // Move focus to the error alert whenever a new server error lands, same
  // pattern as `RegistrationForm` — otherwise a screen reader/keyboard user
  // gets no signal that submission failed (WCAG 2.4.3, 4.1.3).
  React.useEffect(() => {
    if (state.status === "error" && state.message) {
      alertRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-xl">
      <input type="hidden" name="redirectTo" value={redirectTo} />

      {state.status === "error" && state.message && (
        <div
          ref={alertRef}
          role="alert"
          aria-live="assertive"
          tabIndex={-1}
          className="rounded-md border border-destructive/30 bg-destructive/8 px-md py-sm text-body-md text-destructive-text outline-none"
        >
          {state.message}
        </div>
      )}

      <section className="flex flex-col gap-lg">
        <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <Field
            id="phone"
            label="Phone"
            type="tel"
            required
            defaultValue={defaults.phone}
          />
          <Field
            id="institution"
            label="School / institution"
            required
            defaultValue={defaults.institution}
          />
        </div>

        <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <Field
            id="dateOfBirth"
            label="Date of birth"
            type="date"
            required
            defaultValue={defaults.dateOfBirth}
          />
          <Field
            id="gradeOrYear"
            label="Grade / year of study"
            required
            defaultValue={defaults.gradeOrYear}
          />
        </div>

        <TextareaField
          id="residentialAddress"
          label="Residential address"
          required
          defaultValue={defaults.residentialAddress}
        />

        <div className="flex flex-col gap-xs">
          <Label htmlFor="requiresTransportation">
            Do you require transportation?
            <span className="text-destructive-text" aria-hidden>
              *
            </span>
          </Label>
          <select
            id="requiresTransportation"
            name="requiresTransportation"
            required
            defaultValue={defaults.requiresTransportation ? "yes" : "no"}
            className={selectClassName}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>
      </section>

      <section className="flex flex-col gap-lg border-t border-border pt-lg">
        <div className="flex flex-col gap-xxs">
          <h2 className="font-display text-title-lg text-ink">Emergency contact</h2>
        </div>

        <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <Field
            id="emergencyContactName"
            label="Emergency contact name"
            required
            defaultValue={defaults.emergencyContactName}
            help="Parent or guardian name"
          />
          <Field
            id="emergencyContactPhone"
            label="Emergency contact phone"
            type="tel"
            required
            defaultValue={defaults.emergencyContactPhone}
          />
        </div>

        <Field
          id="emergencyContactRelation"
          label="Emergency contact relation"
          required
          defaultValue={defaults.emergencyContactRelation}
          placeholder="Parent, Guardian, …"
        />
      </section>

      <section className="flex flex-col gap-lg border-t border-border pt-lg">
        <TextareaField
          id="munExperience"
          label="Past MUN experience"
          defaultValue={defaults.munExperience}
          help="Conferences, committees, portfolios, awards — or leave blank if this is your first."
        />

        <Field id="referralCode" label="Referral code" defaultValue={defaults.referralCode} />
      </section>

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2Icon className="animate-spin" aria-hidden />
          Saving…
        </>
      ) : (
        <>
          <SaveIcon aria-hidden />
          Save profile
        </>
      )}
    </Button>
  );
}

/** Matches `components/registration/registration-form.tsx`'s `Field` conventions. */
function Field({
  id,
  label,
  type = "text",
  required,
  defaultValue,
  placeholder,
  help,
}: {
  id: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  help?: string;
}) {
  const helpId = `${id}-help`;
  return (
    <div className="flex flex-col gap-xs">
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="text-destructive-text" aria-hidden>
            *
          </span>
        )}
      </Label>
      <Input
        id={id}
        name={id}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        aria-describedby={help ? helpId : undefined}
      />
      {help && (
        <p id={helpId} className="text-body-md text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}

function TextareaField({
  id,
  label,
  required,
  defaultValue,
  help,
}: {
  id: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  help?: string;
}) {
  const helpId = `${id}-help`;
  return (
    <div className="flex flex-col gap-xs">
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="text-destructive-text" aria-hidden>
            *
          </span>
        )}
      </Label>
      <textarea
        id={id}
        name={id}
        required={required}
        defaultValue={defaultValue}
        aria-describedby={help ? helpId : undefined}
        rows={3}
        className={textareaClassName}
      />
      {help && (
        <p id={helpId} className="text-body-md text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}
