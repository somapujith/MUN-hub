import { Helmet } from "react-helmet-async";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import { signIn } from "@/api/auth";
import { queryKeys } from "@/api/query-keys";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeRedirectTo } from "@/lib/redirect";

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

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const redirectTo = safeRedirectTo(searchParams.get("redirectTo") ?? searchParams.get("redirect"));
  const returningTo = destinationLabel(redirectTo);
  const signupHref = redirectTo !== "/" ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}` : "/signup";

  const signInMutation = useMutation({
    mutationFn: signIn,
    onSuccess: (session) => {
      // Drop everything cached under whatever (anonymous, or a previous
      // account's) identity was active before, then seed the session query
      // directly with the real result so `useSession`/`RequireAuth` see the
      // signed-in account right away instead of waiting on a refetch.
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session(), session);
      navigate(redirectTo, { replace: true });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    signInMutation.mutate({ email, password });
  }

  const errorMessage = signInMutation.isError
    ? signInMutation.error instanceof Error
      ? signInMutation.error.message
      : "Unable to sign in."
    : undefined;

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
              Sign in to continue
              {returningTo ? ` to ${returningTo}` : ""}.
            </p>
          </header>

          <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-md" noValidate>
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
                <Link
                  to="/forgot-password"
                  className="text-body-md text-link underline-offset-2 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Your password"
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

            <Button type="submit" className="w-full" disabled={signInMutation.isPending}>
              {signInMutation.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-xl border-t border-border pt-lg text-body-md text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link to={signupHref} className="text-link underline underline-offset-2">
              Create an account
            </Link>
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
