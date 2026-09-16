import { Helmet } from "react-helmet-async";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { SupportPanel } from "@/components/support/support-panel";
import { RequireRole } from "@/guards/require-role";
import { useSession } from "@/hooks/use-session";

export function OrganizerSupportPage() {
  const { data: session } = useSession();

  return (
    <RequireRole roles={["ORGANIZER"]}>
      <div className="flex min-h-full flex-1 flex-col">
        <Helmet>
          <title>Support</title>
          <meta name="description" content="Chat with the MUN Hub support team." />
        </Helmet>
        <SiteHeader session={session ?? null} />
        <main className="flex-1 bg-surface-soft/60">
          <div className="content-container flex flex-col gap-lg py-xl">
            <header className="flex flex-col gap-xxs border-b border-border pb-lg">
              <h1 className="font-display text-display-md text-ink">Support</h1>
              <p className="text-body-md text-muted-foreground">
                Chat with our team about your MUN listing, payments, or anything else.
              </p>
            </header>
            <SupportPanel variant="page" />
          </div>
        </main>
        <SiteFooter />
      </div>
    </RequireRole>
  );
}
