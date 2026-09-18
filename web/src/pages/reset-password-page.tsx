import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate, useSearchParams } from "react-router";
import { confirmPasswordReset } from "@/api/password-reset";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useScrollToTop } from "@/hooks/use-scroll-to-top";

const MIN_PASSWORD_LENGTH = 8;

function ErrorAlert({ id, message }: { id: string; message: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-xs rounded-sm border border-destructive/30 bg-destructive/8 px-sm py-sm text-body-md text-destructive-text"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-px size-4 shrink-0 fill-current">
        <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM8 12a.9.9 0 1 1 0-1.8A.9.9 0 0 1 8 12Z" />
      </svg>
      <span>{message}</span>
    </p>
  );
}

export function ResetPasswordPage() {
  useScrollToTop();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const resetMutation = useMutation({
    mutationFn: () => confirmPasswordReset(token, newPassword),
    onSuccess: () => navigate("/login?reset=success"),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError("Passwords do not match.");
      return;
    }
    resetMutation.mutate();
  }

  const serverError =
    resetMutation.isError
      ? resetMutation.error instanceof Error
        ? resetMutation.error.message
        : "Unable to reset your password. Try again."
      : null;
  const errorMessage = validationError ?? serverError;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <Helmet>
        <title>Reset password | MUN Hub</title>
        <meta name="description" content="Set a new password for your MUN Hub account." />
      </Helmet>

      <SiteHeader />

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <div className="w-full max-w-[400px]">
          {!token ? (
            <div className="flex flex-col gap-md">
              <header className="flex flex-col gap-xs">
                <h1 className="font-display text-title-lg text-ink md:text-display-md">
                  Invalid reset link
                </h1>
                <p className="text-body-md text-muted-foreground">
                  This link is missing its reset token. Request a new one to continue.
                </p>
              </header>
              <Button render={<Link to="/forgot-password" />}>Request a new link</Button>
            </div>
          ) : (
            <>
              <header className="flex flex-col gap-xs">
                <h1 className="font-display text-title-lg text-ink md:text-display-md">
                  Choose a new password
                </h1>
                <p className="text-body-md text-muted-foreground">
                  Enter a new password for your account. This will sign you out everywhere
                  else.
                </p>
              </header>

              <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-md">
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    aria-invalid={errorMessage ? true : undefined}
                    aria-describedby={errorMessage ? "reset-password-error" : undefined}
                  />
                </div>

                <div className="flex flex-col gap-xs">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    aria-invalid={errorMessage ? true : undefined}
                    aria-describedby={errorMessage ? "reset-password-error" : undefined}
                  />
                </div>

                {errorMessage ? <ErrorAlert id="reset-password-error" message={errorMessage} /> : null}

                <Button type="submit" className="w-full" disabled={resetMutation.isPending}>
                  {resetMutation.isPending ? "Resetting…" : "Reset password"}
                </Button>
              </form>
            </>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
