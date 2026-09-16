import { Helmet } from "react-helmet-async";
import { Link } from "react-router";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { LoginForm } from "@/components/auth/login-form";

/**
 * The organizer door. Same credential endpoint as `/login` — the difference is
 * signposting (an organizer never has to guess whether the delegate-facing
 * sign-in is "theirs") and destination (straight into the organizer workspace,
 * which in production lives on organize.munhub.in).
 *
 * A delegate who signs in here isn't rejected; they're shown where they belong.
 */
export function OrganizerLoginPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <Helmet>
        <title>Organizer sign in | MUN Hub</title>
        <meta
          name="description"
          content="Sign in to your MUN Hub organizer workspace to manage your conference."
        />
      </Helmet>

      <SiteHeader />

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <LoginForm
          door={{
            title: "Organizer sign in",
            subtitle: "Manage your conference, delegates, and registrations.",
            expectedRoles: ["ORGANIZER"],
            footer: (
              <div className="flex flex-col gap-xs">
                <p>
                  Don&apos;t host a conference yet?{" "}
                  <Link to="/organizer/apply" className="text-link underline underline-offset-2">
                    Apply to host
                  </Link>
                </p>
                <p>
                  Registering as a delegate?{" "}
                  <Link to="/login" className="text-link underline underline-offset-2">
                    Delegate sign in
                  </Link>
                </p>
              </div>
            ),
          }}
        />
      </main>

      <SiteFooter />
    </div>
  );
}
