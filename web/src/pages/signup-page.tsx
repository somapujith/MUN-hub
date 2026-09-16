import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate, useSearchParams } from "react-router";
import { signUp } from "@/api/auth";
import { queryKeys } from "@/api/query-keys";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeRedirectTo } from "@/lib/redirect";

// Mirrors lib/actions/auth.ts's MIN_PASSWORD_LENGTH — checked client-side for
// fast feedback, but the server re-validates regardless.
const MIN_PASSWORD_LENGTH = 8;

export function SignupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const redirectTo = safeRedirectTo(searchParams.get("redirectTo") ?? searchParams.get("redirect"));
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const signUpMutation = useMutation({
    mutationFn: signUp,
    onSuccess: (session) => {
      // Drop everything cached under whatever (anonymous) identity was
      // active before, then seed the session query directly with the real
      // result so `useSession`/`RequireAuth` see the new account right away.
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session(), session);
      navigate("/profile", { replace: true });
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "Unable to create your account.");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    signUpMutation.mutate({ name, email, password });
  }

  const errorMessage = formError;
  const loginHref = redirectTo !== "/" ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/login";

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <Helmet>
        <title>Create an account | MUN Hub</title>
        <meta
          name="description"
          content="Create a MUN Hub student account to register for conferences and track your applications."
        />
      </Helmet>

      <SiteHeader />

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <div className="w-full max-w-[400px]">
          <header className="flex flex-col gap-xs">
            <h1 className="font-display text-title-lg text-ink md:text-display-md">
              Create your account
            </h1>
            <p className="text-body-md text-muted-foreground">
              Sign up as a student to register for conferences on MUN Hub.
            </p>
          </header>

          <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-md" noValidate>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                autoFocus
                required
                placeholder="Alex Kumar"
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
                minLength={MIN_PASSWORD_LENGTH}
                placeholder="At least 8 characters"
              />
            </div>

            <div className="flex flex-col gap-xs">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                placeholder="Re-enter your password"
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

            <Button type="submit" className="w-full" disabled={signUpMutation.isPending}>
              {signUpMutation.isPending ? "Creating account…" : "Create account"}
            </Button>
          </form>

          <p className="mt-xl border-t border-border pt-lg text-body-md text-muted-foreground">
            Already have an account?{" "}
            <Link to={loginHref} className="text-link underline underline-offset-2">
              Sign in
            </Link>
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
