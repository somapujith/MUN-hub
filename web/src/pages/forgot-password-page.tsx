import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router";
import { MailCheckIcon } from "lucide-react";
import { requestPasswordReset } from "@/api/password-reset";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const requestMutation = useMutation({
    mutationFn: (value: string) => requestPasswordReset(value),
    // Never branch UI on whether the request "succeeded" here — a mismatched
    // email and a genuine account both end up on the exact same confirmation
    // screen, so this account's existence is never revealed one way or the
    // other, matching lib/actions/password-reset.ts#requestPasswordReset.
    onSettled: () => setSubmitted(true),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    requestMutation.mutate(trimmed);
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <Helmet>
        <title>Forgot password | MUN Hub</title>
        <meta
          name="description"
          content="Request a password reset link for your MUN Hub account."
        />
      </Helmet>

      <SiteHeader />

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <div className="w-full max-w-[400px]">
          {submitted ? (
            <div className="flex flex-col items-start gap-md">
              <span
                aria-hidden
                className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success-text"
              >
                <MailCheckIcon strokeWidth={1.75} className="size-6" />
              </span>
              <div className="flex flex-col gap-xs">
                <h1 className="font-display text-title-lg text-ink md:text-display-md">
                  Check your email
                </h1>
                <p className="text-body-md text-muted-foreground">
                  If an account exists for <strong className="text-ink">{email.trim()}</strong>,
                  we&apos;ve sent a link to reset your password. It expires in 1 hour and can
                  only be used once.
                </p>
              </div>
              <Button variant="outline" render={<Link to="/login" />}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <>
              <header className="flex flex-col gap-xs">
                <h1 className="font-display text-title-lg text-ink md:text-display-md">
                  Forgot your password?
                </h1>
                <p className="text-body-md text-muted-foreground">
                  Enter the email on your account and we&apos;ll send you a link to reset it.
                </p>
              </header>

              <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-md">
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
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={requestMutation.isPending}>
                  {requestMutation.isPending ? "Sending…" : "Send reset link"}
                </Button>
              </form>

              <p className="mt-lg text-body-md text-muted-foreground">
                Remembered it after all?{" "}
                <Link to="/login" className="text-link underline underline-offset-2">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
