import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Link, useSearchParams } from "react-router";
import { resendVerificationEmail, verifyEmail } from "@/api/email-verification";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ErrorAlert({ message }: { message: string }) {
  return (
    <p
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

/** The resend form — shown whenever there's no token to consume, or the token turned out to be invalid/expired. */
function ResendForm() {
  const [email, setEmail] = useState("");
  const resendMutation = useMutation({ mutationFn: () => resendVerificationEmail(email) });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resendMutation.mutate();
  }

  if (resendMutation.isSuccess) {
    return (
      <p className="text-body-md text-muted-foreground">
        If an account exists for that email, we've sent a fresh verification link.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-md">
      <div className="flex flex-col gap-xs">
        <Label htmlFor="resend-email">Email address</Label>
        <Input
          id="resend-email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={resendMutation.isPending}>
        {resendMutation.isPending ? "Sending…" : "Resend verification email"}
      </Button>
    </form>
  );
}

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const attempted = useRef(false);

  const verifyMutation = useMutation({ mutationFn: () => verifyEmail(token) });

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    verifyMutation.mutate();
    // verifyMutation is a new object identity every render (useMutation),
    // and the ref guard above is what actually prevents a re-fire — do not
    // add it to the dependency array, that would defeat the guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  let body: React.ReactNode;

  if (!token) {
    body = (
      <>
        <header className="flex flex-col gap-xs">
          <h1 className="font-display text-title-lg text-ink md:text-display-md">Verify your email</h1>
          <p className="text-body-md text-muted-foreground">
            This link is missing its verification token. Enter your email to get a new one.
          </p>
        </header>
        <div className="mt-xl">
          <ResendForm />
        </div>
      </>
    );
  } else if (verifyMutation.isPending || verifyMutation.isIdle) {
    body = (
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-title-lg text-ink md:text-display-md">Verifying your email…</h1>
        <p className="text-body-md text-muted-foreground">This will just take a moment.</p>
      </header>
    );
  } else if (verifyMutation.isSuccess) {
    body = (
      <>
        <header className="flex flex-col gap-xs">
          <h1 className="font-display text-title-lg text-ink md:text-display-md">Email verified</h1>
          <p className="text-body-md text-muted-foreground">Your email address is confirmed.</p>
        </header>
        <Button className="mt-xl w-full" render={<Link to="/dashboard" />}>
          Continue to your dashboard
        </Button>
      </>
    );
  } else {
    const message =
      verifyMutation.error instanceof Error
        ? verifyMutation.error.message
        : "Unable to verify your email. Try again.";
    body = (
      <>
        <header className="flex flex-col gap-xs">
          <h1 className="font-display text-title-lg text-ink md:text-display-md">Verification failed</h1>
        </header>
        <div className="mt-md flex flex-col gap-md">
          <ErrorAlert message={message} />
          <ResendForm />
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <Helmet>
        <title>Verify email | MUN Hub</title>
        <meta name="description" content="Verify your MUN Hub account email address." />
      </Helmet>

      <SiteHeader />

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <div className="w-full max-w-[400px]">{body}</div>
      </main>

      <SiteFooter />
    </div>
  );
}
