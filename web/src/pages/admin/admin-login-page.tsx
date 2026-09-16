import { Helmet } from "react-helmet-async";
import { SiteFooter } from "@/components/layout/site-footer";
import { LoginForm } from "@/components/auth/login-form";

/**
 * Staff door. Deliberately NOT linked from the public nav — advertising the
 * highest-privilege entrance on a public marketplace invites credential
 * stuffing for no user benefit. Staff reach it directly, or land here via
 * admin.munhub.in.
 *
 * `noindex` for the same reason; and no `SiteHeader`, which would render the
 * marketplace's browse/search chrome around a staff login for no reason.
 */
export function AdminLoginPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <Helmet>
        <title>Staff sign in | MUN Hub</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <main className="flex flex-1 items-start justify-center px-lg py-xxl md:items-center md:py-section">
        <LoginForm
          door={{
            title: "Staff sign in",
            subtitle: "Operations and admin access to the MUN Hub console.",
            expectedRoles: ["OPERATIONS", "ADMIN", "SUPER_ADMIN"],
          }}
        />
      </main>

      <SiteFooter />
    </div>
  );
}
