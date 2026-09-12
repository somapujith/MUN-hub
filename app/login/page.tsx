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
  searchParams: Promise<{ error?: string; redirectTo?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  "missing-email": "Enter an email address to continue.",
  "not-found":
    "No account matches that email. This demo only recognises the seeded accounts listed below.",
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

          <form action={loginAction} className="mt-xl flex flex-col gap-md">
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

          {/* Honest disclosure: this is passwordless mock auth. Saying so beats
              shipping a password field that checks nothing. */}
          <div className="mt-xl border-t border-border pt-lg">
            <p className="text-caption text-ink">Demo sign-in — no password</p>
            <p className="mt-xxs text-body-md text-muted-foreground">
              MUN Hub is running on mock authentication for this preview. Any seeded
              email signs you straight in; real credentials land before launch.
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
