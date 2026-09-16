import type { FormEvent, ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import { signIn } from "@/api/auth";
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

  const signInMutation = useMutation({
    mutationFn: signIn,
    onSuccess: (session: Session) => {
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
    },
  });

  const session = signInMutation.data;
  const landedAtWrongDoor =
    Boolean(session) && door.expectedRoles !== null && !door.expectedRoles.includes(session!.role);

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

  if (landedAtWrongDoor && session) {
    const home = homeUrlForRole(session.role);
    return (
      <div className="w-full max-w-[400px]">
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

  return (
    <div className="w-full max-w-[400px]">
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
