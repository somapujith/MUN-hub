import { Helmet } from "react-helmet-async";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { HelpCenter } from "@/components/support/help-center";
import { DELEGATE_HELP_CATEGORIES, DELEGATE_HELP_TOPICS } from "@/components/support/help-topics";
import { SupportPanel } from "@/components/support/support-panel";
import { SupportRedirect } from "@/components/support/support-redirect";
import { inboxUrlForRole } from "@/components/support/support-labels";
import { useSession } from "@/hooks/use-session";
import { resolveZoneUrl } from "@/lib/host-routing";
import { useScrollToTop } from "@/hooks/use-scroll-to-top";

const STAFF_ROLES = new Set(["OPERATIONS", "ADMIN", "SUPER_ADMIN"]);

/** /dashboard/support — a delegate's support inbox. Route-guarded by RequireAuth. */
export function StudentSupportPage() {
  useScrollToTop();
  const { data: session } = useSession();

  // Organizers and staff each have their own support screen.
  if (session?.role === "ORGANIZER") return <SupportRedirect url={inboxUrlForRole("ORGANIZER")} />;
  if (session && STAFF_ROLES.has(session.role)) return <SupportRedirect url={resolveZoneUrl("admin", "/admin/support")} />;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>Support | MUN Hub</title>
        <meta name="description" content="Find answers about MUN Hub, or message our support team." />
      </Helmet>
      <SiteHeader />
      <main className="content-container flex flex-1 flex-col gap-xl py-xl">
        <header className="flex flex-col gap-xxs">
          <h1 className="font-display text-display-md text-ink">Support</h1>
          <p className="text-body-md text-muted-foreground">
            Search for an answer below, or message our team if you can&apos;t find one.
          </p>
        </header>

        <HelpCenter topics={DELEGATE_HELP_TOPICS} categories={DELEGATE_HELP_CATEGORIES} />

        <section id="contact-support" className="flex scroll-mt-24 flex-col gap-md border-t border-border pt-xl">
          <div className="flex flex-col gap-xxs">
            <h2 className="font-display text-title-lg text-ink">Still need help?</h2>
            <p className="text-body-md text-muted-foreground">
              Message our team about your registrations, payments, or anything else. Replies arrive here.
            </p>
          </div>
          <SupportPanel variant="page" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
