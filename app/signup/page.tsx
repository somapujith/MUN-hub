import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signupAction } from "./actions";
import { safeRedirectTo } from "../login/redirect";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create a MUN Hub account to register for conferences.",
};

interface SignupPageProps {
  searchParams: Promise<{ error?: string; redirectTo?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  "password-mismatch": "Those passwords don't match. Try again.",
  "email-taken": "An account with that email already exists. Try signing in instead.",
  "weak-password": "Password must be at least 8 characters.",
  "missing-name": "Enter your name to continue.",
  unknown: "Something went wrong creating your account. Please try again.",
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const redirectTo = safeRedirectTo(params.redirectTo);
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] : undefined;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <SiteHeader />

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <div className="w-full max-w-[400px]">
          <header className="flex flex-col gap-xs">
            <h1 className="font-display text-title-lg text-ink md:text-display-md">
              Create your account
            </h1>
            <p className="text-body-md text-muted-foreground">
              Set up a MUN Hub account to register for conferences.
            </p>
          </header>

          <form action={signupAction} className="mt-xl flex flex-col gap-md">
            <input type="hidden" name="redirectTo" value={redirectTo} />

            <div className="flex flex-col gap-xs">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                autoFocus
                required
                placeholder="Ada Lovelace"
                aria-invalid={errorMessage ? true : undefined}
                aria-describedby={errorMessage ? "signup-error" : undefined}
              />
            </div>

            <div className="flex flex-col gap-xs">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@school.edu"
                aria-invalid={errorMessage ? true : undefined}
                aria-describedby={errorMessage ? "signup-error" : undefined}
              />
            </div>

            <div className="flex flex-col gap-xs">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                aria-invalid={errorMessage ? true : undefined}
                aria-describedby={errorMessage ? "signup-error" : undefined}
              />
              <p className="text-body-sm text-muted-foreground">At least 8 characters.</p>
            </div>

            <div className="flex flex-col gap-xs">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                aria-invalid={errorMessage ? true : undefined}
                aria-describedby={errorMessage ? "signup-error" : undefined}
              />
            </div>

            {errorMessage ? (
              <p
                id="signup-error"
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
              Create account
            </Button>
          </form>

          <p className="mt-md text-body-md text-muted-foreground">
            Already have an account?{" "}
            <a
              href={`/login?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="font-medium text-ink underline underline-offset-2"
            >
              Sign in
            </a>
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
