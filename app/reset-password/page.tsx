import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "./actions";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Set a new password for your MUN Hub account.",
};

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string; error?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  "password-mismatch": "Those passwords don't match. Try again.",
  "invalid-token": "This reset link is invalid or has expired. Request a new one.",
  "weak-password": "Password must be at least 8 characters.",
  unknown: "Something went wrong resetting your password. Please try again.",
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params.token;
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] : undefined;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <SiteHeader />

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <div className="w-full max-w-[400px]">
          <header className="flex flex-col gap-xs">
            <h1 className="font-display text-title-lg text-ink md:text-display-md">
              Reset your password
            </h1>
            {token ? (
              <p className="text-body-md text-muted-foreground">
                Choose a new password for your account.
              </p>
            ) : null}
          </header>

          {!token ? (
            <p className="mt-xl rounded-sm border border-destructive/30 bg-destructive/8 px-sm py-sm text-body-md text-destructive-text">
              This reset link is missing its token — request a new one.
            </p>
          ) : (
            <form action={resetPasswordAction} className="mt-xl flex flex-col gap-md">
              <input type="hidden" name="token" value={token} />

              <div className="flex flex-col gap-xs">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  required
                  aria-invalid={errorMessage ? true : undefined}
                  aria-describedby={errorMessage ? "reset-password-error" : undefined}
                />
                <p className="text-body-sm text-muted-foreground">At least 8 characters.</p>
              </div>

              <div className="flex flex-col gap-xs">
                <Label htmlFor="confirmNewPassword">Confirm new password</Label>
                <Input
                  id="confirmNewPassword"
                  name="confirmNewPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-invalid={errorMessage ? true : undefined}
                  aria-describedby={errorMessage ? "reset-password-error" : undefined}
                />
              </div>

              {errorMessage ? (
                <p
                  id="reset-password-error"
                  role="alert"
                  className="flex items-start gap-xs rounded-sm border border-destructive/30 bg-destructive/8 px-sm py-sm text-body-md text-destructive-text"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    className="mt-px size-4 shrink-0 fill-current"
                  >
                    <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM8 12a.9.9 0 1 1 0-1.8A.9.9 0 0 1 8 12Z" />
                  </svg>
                  <span>{errorMessage}</span>
                </p>
              ) : null}

              <Button type="submit" className="w-full">
                Reset password
              </Button>
            </form>
          )}

          <p className="mt-md text-body-md text-muted-foreground">
            <a href="/forgot-password" className="font-medium text-ink underline underline-offset-2">
              {token ? "Request a new link" : "Back to reset request"}
            </a>
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
