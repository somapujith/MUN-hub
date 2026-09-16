import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "./actions";
import { safeRedirectTo } from "./redirect";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to MUN Hub to register for conferences and manage your applications.",
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string; redirectTo?: string; reset?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  "missing-email": "Enter an email address to continue.",
  "invalid-credentials": "That email or password isn't right. Double-check and try again.",
  suspended: "This account has been suspended. Contact support if you think that's a mistake.",
};

/**
 * Where the user came from, surfaced as a plain-language line so the redirect
 * isn't a silent teleport after sign-in.
 */
const DESTINATION_LABELS: { prefix: string; label: string }[] = [
  { prefix: "/organizer/apply", label: "your organizer application" },
  { prefix: "/organizer", label: "your organizer dashboard" },
  { prefix: "/register", label: "your registration" },
  { prefix: "/dashboard", label: "your dashboard" },
  { prefix: "/admin", label: "the admin console" },
];

function destinationLabel(redirectTo: string): string | undefined {
  return DESTINATION_LABELS.find((d) => redirectTo.startsWith(d.prefix))?.label;
}

/** Seeded demo identities — mirrors `lib/db/seed.ts`. */
const DEMO_ACCOUNTS = [
  { email: "student@munhub.test", role: "Student" },
  { email: "organizer@munhub.test", role: "Organizer" },
  { email: "admin@munhub.test", role: "Admin" },
];

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const redirectTo = safeRedirectTo(params.redirectTo);
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] : undefined;
  const returningTo = destinationLabel(redirectTo);
  const resetSuccess = params.reset === "success";

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <SiteHeader />

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <div className="w-full max-w-[400px]">
          {/* Headline block — title-lg per the doc's calm-utility register, not a
              display-size marketing hero. Weight stays 400; emphasis is size. */}
          <header className="flex flex-col gap-xs">
            <h1 className="font-display text-title-lg text-ink md:text-display-md">
              Welcome back
            </h1>
            <p className="text-body-md text-muted-foreground">
              Enter your email to continue
              {returningTo ? ` to ${returningTo}` : ""}.
            </p>
          </header>

          {resetSuccess ? (
            <p
              role="status"
              className="mt-xl flex items-start gap-xs rounded-sm border border-border bg-surface-soft px-sm py-sm text-body-md text-ink"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="mt-px size-4 shrink-0 fill-current"
              >
                <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm3.28 4.72a.75.75 0 0 1 0 1.06l-4 4a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 1 1 1.06-1.06l1.47 1.47 3.47-3.47a.75.75 0 0 1 1.06 0Z" />
              </svg>
              <span>Password updated. Sign in with your new password.</span>
            </p>
          ) : null}

          <form action={loginAction} className={resetSuccess ? "mt-md flex flex-col gap-md" : "mt-xl flex flex-col gap-md"}>
            <input type="hidden" name="redirectTo" value={redirectTo} />

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
                aria-describedby={errorMessage ? "login-error" : undefined}
              />
            </div>

            <div className="flex flex-col gap-xs">
              <div className="flex items-center justify-between gap-sm">
                <Label htmlFor="password">Password</Label>
                <a
                  href="/forgot-password"
                  className="text-body-sm font-medium text-ink underline underline-offset-2"
                >
                  Forgot password?
                </a>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                aria-invalid={errorMessage ? true : undefined}
                aria-describedby={errorMessage ? "login-error" : undefined}
              />
            </div>

            {errorMessage ? (
              <p
                id="login-error"
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
              Continue
            </Button>
          </form>

          <p className="mt-md text-body-md text-muted-foreground">
            New here?{" "}
            <a
              href={`/signup?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="font-medium text-ink underline underline-offset-2"
            >
              Create an account
            </a>
          </p>

          <div className="mt-xl border-t border-border pt-lg">
            <p className="text-caption text-ink">Demo accounts</p>
            <p className="mt-xxs text-body-md text-muted-foreground">
              Password for every demo account: <code className="font-mono">munhub-demo</code>
            </p>

            <ul className="mt-md flex flex-col gap-xxs">
              {DEMO_ACCOUNTS.map((account) => (
                <li
                  key={account.email}
                  className="flex items-center justify-between gap-md rounded-sm bg-surface-soft px-sm py-xs"
                >
                  <code className="font-mono text-body-md text-ink">{account.email}</code>
                  <span className="text-body-md text-muted-foreground">{account.role}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
