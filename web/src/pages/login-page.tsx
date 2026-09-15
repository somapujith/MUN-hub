import { Helmet } from "react-helmet-async";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeRedirectTo } from "@/lib/redirect";

const ERROR_MESSAGES: Record<string, string> = {
  "missing-email": "Enter an email address to continue.",
  "not-found":
    "No account matches that email. This demo only recognises the seeded accounts listed below.",
};

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

const DEMO_ACCOUNTS = [
  { email: "student@munhub.test", role: "Student" },
  { email: "organizer@munhub.test", role: "Organizer" },
  { email: "admin@munhub.test", role: "Admin" },
];

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirectTo = safeRedirectTo(searchParams.get("redirectTo") ?? searchParams.get("redirect"));
  const errorMessage = searchParams.get("error")
    ? ERROR_MESSAGES[searchParams.get("error")!]
    : undefined;
  const returningTo = destinationLabel(redirectTo);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!email) {
      navigate(`/login?error=missing-email&redirect=${encodeURIComponent(redirectTo)}`);
      return;
    }
    const known = DEMO_ACCOUNTS.some((a) => a.email === email);
    if (!known) {
      navigate(`/login?error=not-found&redirect=${encodeURIComponent(redirectTo)}`);
      return;
    }
    // Mock auth — real session lands with API client (step 4)
    navigate(redirectTo);
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <Helmet>
        <title>Sign in | MUN Hub</title>
        <meta
          name="description"
          content="Sign in to MUN Hub to register for conferences and manage your applications."
        />
      </Helmet>

      <SiteHeader />

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <div className="w-full max-w-[400px]">
          <header className="flex flex-col gap-xs">
            <h1 className="font-display text-title-lg text-ink md:text-display-md">
              Welcome back
            </h1>
            <p className="text-body-md text-muted-foreground">
              Enter your email to continue
              {returningTo ? ` to ${returningTo}` : ""}.
            </p>
          </header>

          <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-md">
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
