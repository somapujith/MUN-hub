import { Helmet } from "react-helmet-async";
import { Link, useSearchParams } from "react-router";
import { CheckCircle2Icon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { LoginForm } from "@/components/auth/login-form";
import { safeRedirectTo } from "@/lib/redirect";

/**
 * The general-purpose door. `expectedRoles: null` — it accepts any account and
 * routes by role, so an organizer who reaches for the familiar "Sign in" still
 * lands in their workspace rather than being told they used the wrong entrance.
 * The labelled `/organizer/login` and `/admin/login` doors exist for
 * signposting, not for gatekeeping.
 */
export function LoginPage() {
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirectTo(searchParams.get("redirectTo") ?? searchParams.get("redirect"));
  // reset-password-page sends people here after a successful reset. Neutral
  // confirmation (not an error) — the reset signed every session out, so
  // they need to sign in again with the new password.
  const passwordWasReset = searchParams.get("reset") === "success";
  const signupHref = redirectTo !== "/" ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}` : "/signup";

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
        <div className="flex w-full max-w-[400px] flex-col gap-lg">
          {passwordWasReset && (
            <div
              role="status"
              className="flex items-start gap-sm rounded-md border border-border bg-muted px-md py-sm text-body-md text-ink"
            >
              <CheckCircle2Icon aria-hidden className="mt-[2px] size-4 shrink-0 text-muted-foreground" />
              <p>Your password has been reset. Sign in with your new password.</p>
            </div>
          )}
          <LoginForm
            door={{
              title: "Welcome back",
              subtitle: "Sign in to register for conferences and manage your registrations.",
              expectedRoles: null,
              footer: (
                <div className="flex flex-col gap-xs">
                  <p>
                    Don&apos;t have an account?{" "}
                    <Link to={signupHref} className="text-link underline underline-offset-2">
                      Create an account
                    </Link>
                  </p>
                  <p>
                    Running a conference?{" "}
                    <Link to="/organizer/login" className="text-link underline underline-offset-2">
                      Organizer sign in
                    </Link>
                  </p>
                </div>
              ),
            }}
          />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
