import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import { completeMfaChallenge, signIn } from "@/api/auth";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeRedirectTo } from "@/lib/redirect";
import { homeUrlForRole, isCrossOrigin } from "@/lib/host-routing";
import type { Role } from "@/types/enums";
import type { Session } from "@/types";

const ROLE_LABEL: Record<Role, string> = {
  STUDENT: "Delegate",
  ORGANIZER: "Organizer",
  OPERATIONS: "Operations",
  ADMIN: "Admin",
  SUPER_ADMIN: "Admin",
};

export interface LoginDoor {
  /** Heading, e.g. "Welcome back" / "Organizer sign in". */
  title: string;
  /** Sub-heading under the title. */
  subtitle: string;
  /**
   * Roles this door is meant for, or `null` for the general-purpose door that
   * accepts anyone and routes them by role.
   *
   * A door does NOT reject a valid credential for the "wrong" role — the
   * account is still signed in, because refusing a correct password would be
   * both confusing and pointless (the same credential works one URL over).
   * Instead the user gets told which door they landed on and is handed a link
   * to where they actually belong.
   */
  expectedRoles: readonly Role[] | null;
  /** Rendered under the form (signup prompt, cross-door links). */
  footer?: ReactNode;
}

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

export function LoginForm({ door }: { door: LoginDoor }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const redirectTo = safeRedirectTo(searchParams.get("redirectTo") ?? searchParams.get("redirect"));
  const returningTo = destinationLabel(redirectTo);

  // Set only when POST /auth/session answered MFA_REQUIRED (staff account,
  // confirmed TOTP enrollment) — swaps the form to the code step below.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  function completeSignIn(session: Session) {
    // Drop everything cached under whatever (anonymous, or a previous
    // account's) identity was active before, then seed the session query
    // directly so `useSession`/`RequireAuth` see the signed-in account right
    // away instead of waiting on a refetch.
    queryClient.clear();
    queryClient.setQueryData(queryKeys.session(), session);

    const wrongDoor = door.expectedRoles !== null && !door.expectedRoles.includes(session.role);
    if (wrongDoor) return; // render the redirect card below instead of navigating

    // An explicit ?redirectTo= (from a RequireAuth bounce) wins — that's the
    // page the user was actually trying to reach. Otherwise send them to the
    // home their role belongs to, which may be a different subdomain.
    const destination = redirectTo !== "/" ? redirectTo : homeUrlForRole(session.role);
    if (isCrossOrigin(destination)) {
      window.location.assign(destination);
      return;
    }
    navigate(destination, { replace: true });
  }

  const signInMutation = useMutation({
    mutationFn: signIn,
    onSuccess: (result) => {
      if (result.status === "MFA_REQUIRED") {
        setPendingToken(result.pendingToken);
        return;
      }
      completeSignIn(result);
    },
  });

  const mfaMutation = useMutation({
    mutationFn: completeMfaChallenge,
    onSuccess: completeSignIn,
  });

  const session = signInMutation.data?.status === "SIGNED_IN" ? signInMutation.data : mfaMutation.data;
  const landedAtWrongDoor =
    Boolean(session) && door.expectedRoles !== null && !door.expectedRoles.includes(session!.role);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    signInMutation.mutate({ email, password });
  }

  function handleMfaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingToken) return;
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").trim();
    mfaMutation.mutate({ pendingToken, code });
  }

  const errorMessage = signInMutation.isError
    ? signInMutation.error instanceof Error
      ? signInMutation.error.message
      : "Unable to sign in."
    : undefined;

  const mfaErrorMessage = mfaMutation.isError
    ? mfaMutation.error instanceof Error
      ? mfaMutation.error.message
      : "Unable to verify that code."
    : undefined;

  if (landedAtWrongDoor && session) {
    const home = homeUrlForRole(session.role);
    return (
      // key: forces React to mount a fresh subtree instead of patching the
      // password step's <form> in place. Without it, the browser can keep an
      // autofill association with the underlying <input> DOM node across the
      // swap — observed as the email address reappearing inside a later step.
      <div key="wrong-door" className="w-full max-w-[400px]">
        <header className="flex flex-col gap-xs">
          <h1 className="font-display text-title-lg text-ink md:text-display-md">
            You&apos;re signed in
          </h1>
          <p className="text-body-md text-muted-foreground">
            This is the {door.title.toLowerCase()} entrance, but your account is a{" "}
            {ROLE_LABEL[session.role]} account. Nothing went wrong — here&apos;s where you belong.
          </p>
        </header>
        <div className="mt-xl flex flex-col gap-sm">
          {isCrossOrigin(home) ? (
            <Button className="w-full" render={<a href={home} />}>
              Continue as {ROLE_LABEL[session.role]}
            </Button>
          ) : (
            <Button className="w-full" render={<Link to={home} />}>
              Continue as {ROLE_LABEL[session.role]}
            </Button>
          )}
          <Button variant="outline" className="w-full" render={<Link to="/" />}>
            Back to marketplace
          </Button>
        </div>
      </div>
    );
  }

  if (pendingToken) {
    return (
      <div key="mfa-step" className="w-full max-w-[400px]">
        <header className="flex flex-col gap-xs">
          <h1 className="font-display text-title-lg text-ink md:text-display-md">
            Two-factor verification
          </h1>
          <p className="text-body-md text-muted-foreground">
            {useRecoveryCode
              ? "Enter one of your 10-character recovery codes."
              : "Enter the 6-digit code from your authenticator app."}
          </p>
        </header>

        <form onSubmit={handleMfaSubmit} className="mt-xl flex flex-col gap-md" noValidate>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="code">{useRecoveryCode ? "Recovery code" : "Verification code"}</Label>
            <Input
              id="code"
              name="code"
              type="text"
              inputMode={useRecoveryCode ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder={useRecoveryCode ? "XXXXX-XXXXX" : "123456"}
              className={useRecoveryCode ? "font-mono uppercase" : "font-mono tracking-[0.3em]"}
              aria-invalid={mfaErrorMessage ? true : undefined}
              aria-describedby={mfaErrorMessage ? "mfa-error" : undefined}
            />
          </div>

          {mfaErrorMessage ? (
            <p
              id="mfa-error"
              role="alert"
              className="flex items-start gap-xs rounded-sm border border-destructive/30 bg-destructive/8 px-sm py-sm text-body-md text-destructive-text"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-px size-4 shrink-0 fill-current">
                <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM8 12a.9.9 0 1 1 0-1.8A.9.9 0 0 1 8 12Z" />
              </svg>
              <span>{mfaErrorMessage}</span>
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={mfaMutation.isPending}>
            {mfaMutation.isPending ? "Verifying…" : "Verify"}
          </Button>
        </form>

        <div className="mt-lg flex flex-col items-start gap-sm text-body-md">
          <button
            type="button"
            className="text-link underline-offset-2 hover:underline"
            onClick={() => setUseRecoveryCode((current) => !current)}
          >
            {useRecoveryCode ? "Use your authenticator app instead" : "Use a recovery code instead"}
          </button>
          <button
            type="button"
            className="text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              setPendingToken(null);
              setUseRecoveryCode(false);
              mfaMutation.reset();
            }}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div key="password-step" className="w-full max-w-[400px]">
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-title-lg text-ink md:text-display-md">{door.title}</h1>
        <p className="text-body-md text-muted-foreground">
          {returningTo ? `Sign in to continue to ${returningTo}.` : door.subtitle}
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
            <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-px size-4 shrink-0 fill-current">
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4ZM8 12a.9.9 0 1 1 0-1.8A.9.9 0 0 1 8 12Z" />
            </svg>
            <span>{errorMessage}</span>
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={signInMutation.isPending}>
          {signInMutation.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {door.footer ? (
        <div className="mt-xl border-t border-border pt-lg text-body-md text-muted-foreground">
          {door.footer}
        </div>
      ) : null}
    </div>
  );
}
