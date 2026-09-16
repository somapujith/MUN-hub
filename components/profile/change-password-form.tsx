"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckIcon, KeyRoundIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction, type ChangePasswordFormState } from "@/app/profile/actions";

const initialState: ChangePasswordFormState = { status: "idle" };

/**
 * Change-password form for the `/profile` "Account & security" section.
 * Styling/structure mirrors `ProfileForm`: same `Field`-style label+input
 * blocks, same focus-to-alert-on-error pattern, same `SubmitButton` via
 * `useFormStatus`.
 */
export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialState);
  const alertRef = React.useRef<HTMLDivElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  // Move focus to the result alert whenever a new server response lands —
  // same pattern as `ProfileForm`, extended to the success case too so a
  // screen reader/keyboard user gets a signal either way.
  React.useEffect(() => {
    if (state.status !== "idle" && state.message) {
      alertRef.current?.focus();
    }
    if (state.status === "success") {
      formRef.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-lg">
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

      {state.status === "success" && state.message && (
        <div
          ref={alertRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className="flex items-center gap-xs rounded-md border border-border bg-surface-soft px-md py-sm text-body-md text-ink outline-none"
        >
          <CheckIcon className="text-primary" aria-hidden />
          {state.message}
        </div>
      )}

      <div className="flex flex-col gap-xs">
        <Label htmlFor="currentPassword">
          Current password
          <span className="text-destructive-text" aria-hidden>
            *
          </span>
        </Label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>

      <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
        <div className="flex flex-col gap-xs">
          <Label htmlFor="newPassword">
            New password
            <span className="text-destructive-text" aria-hidden>
              *
            </span>
          </Label>
          <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
        </div>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="confirmPassword">
            Confirm new password
            <span className="text-destructive-text" aria-hidden>
              *
            </span>
          </Label>
          <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
        </div>
      </div>

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
          Updating…
        </>
      ) : (
        <>
          <KeyRoundIcon aria-hidden />
          Update password
        </>
      )}
    </Button>
  );
}
