import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestResetAction } from "./actions";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a link to reset your MUN Hub password.",
};

interface ForgotPasswordPageProps {
  searchParams: Promise<{ error?: string; sent?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  "missing-email": "Enter an email address to continue.",
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] : undefined;
  const sent = params.sent === "1";

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <SiteHeader />

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <div className="w-full max-w-[400px]">
          <header className="flex flex-col gap-xs">
            <h1 className="font-display text-title-lg text-ink md:text-display-md">
              Reset your password
            </h1>
            {sent ? null : (
              <p className="text-body-md text-muted-foreground">
                Enter your email and we&apos;ll send you a link to reset your password.
              </p>
            )}
          </header>

          {sent ? (
            <p className="mt-xl rounded-sm border border-border bg-surface-soft px-sm py-sm text-body-md text-ink">
              If an account exists for that email, we&apos;ve sent a reset link. It expires in 1
              hour.
            </p>
          ) : (
            <form action={requestResetAction} className="mt-xl flex flex-col gap-md">
              <div className="flex flex-col gap-xs">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  placeholder="you@school.edu"
                  aria-invalid={errorMessage ? true : undefined}
                  aria-describedby={errorMessage ? "forgot-password-error" : undefined}
                />
              </div>

              {errorMessage ? (
                <p
                  id="forgot-password-error"
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
                Send reset link
              </Button>
            </form>
          )}

          <p className="mt-md text-body-md text-muted-foreground">
            <a href="/login" className="font-medium text-ink underline underline-offset-2">
              Back to sign in
            </a>
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
