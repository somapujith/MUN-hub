import { Helmet } from "react-helmet-async";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { SupportPanel } from "@/components/support/support-panel";
import { SupportRedirect } from "@/components/support/support-redirect";
import { inboxUrlForRole } from "@/components/support/support-labels";
import { useSession } from "@/hooks/use-session";
import { resolveZoneUrl } from "@/lib/host-routing";

const STAFF_ROLES = new Set(["OPERATIONS", "ADMIN", "SUPER_ADMIN"]);

/** /dashboard/support — a delegate's support inbox. Route-guarded by RequireAuth. */
export function StudentSupportPage() {
  const { data: session } = useSession();

  // Organizers and staff each have their own support screen.
  if (session?.role === "ORGANIZER") return <SupportRedirect url={inboxUrlForRole("ORGANIZER")} />;
  if (session && STAFF_ROLES.has(session.role)) return <SupportRedirect url={resolveZoneUrl("admin", "/admin/support")} />;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>Support</title>
        <meta name="description" content="Chat with the MUN Hub support team." />
      </Helmet>
      <SiteHeader />
      <main className="content-container flex flex-1 flex-col gap-lg py-xl">
        <header className="flex flex-col gap-xxs">
          <h1 className="font-display text-display-md text-ink">Support</h1>
          <p className="text-body-md text-muted-foreground">
            Chat with our team about your registrations, payments, or anything else. Replies arrive here.
          </p>
        </header>
        <SupportPanel variant="page" />
      </main>
      <SiteFooter />
    </div>
  );
}
