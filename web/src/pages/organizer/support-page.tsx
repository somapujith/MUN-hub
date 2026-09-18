import { Helmet } from "react-helmet-async";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { HelpCenter } from "@/components/support/help-center";
import { ORGANIZER_HELP_CATEGORIES, ORGANIZER_HELP_TOPICS } from "@/components/support/help-topics";
import { SupportPanel } from "@/components/support/support-panel";
import { RequireOrganizer } from "@/guards/require-organizer";

/**
 * /organizer/support — an organizer's support inbox. Signed-out visitors go
 * to the organizer sign-in; non-organizer accounts get the organizer-only
 * notice (RequireRole alone rendered the page, and its 401ing requests, for
 * signed-out visitors).
 */
export function OrganizerSupportPage() {
  return (
    <RequireOrganizer>
      <div className="flex min-h-full flex-1 flex-col">
        <Helmet>
          <title>Support</title>
          <meta name="description" content="Find answers for organizers, or message our support team." />
        </Helmet>
        <SiteHeader />
        <main className="flex-1 bg-surface-soft/60">
          <div className="content-container flex flex-col gap-xl py-xl">
            <header className="flex flex-col gap-xxs border-b border-border pb-lg">
              <h1 className="font-display text-display-md text-ink">Support</h1>
              <p className="text-body-md text-muted-foreground">
                Search for an answer below, or message our team if you can&apos;t find one.
              </p>
            </header>

            <HelpCenter topics={ORGANIZER_HELP_TOPICS} categories={ORGANIZER_HELP_CATEGORIES} />

            <section id="contact-support" className="flex scroll-mt-24 flex-col gap-md border-t border-border pt-xl">
              <div className="flex flex-col gap-xxs">
                <h2 className="font-display text-title-lg text-ink">Still need help?</h2>
                <p className="text-body-md text-muted-foreground">
                  Message our team about your MUN listing, payments, or anything else. Replies arrive here.
                </p>
              </div>
              <SupportPanel variant="page" />
            </section>
          </div>
        </main>
        <SiteFooter />
      </div>
    </RequireOrganizer>
  );
}
