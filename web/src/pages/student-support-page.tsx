import { Helmet } from "react-helmet-async";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { SupportPanel } from "@/components/support/support-panel";

export function StudentSupportPage() {

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>Support</title>
        <meta name="description" content="Chat with the MUN Hub support team." />
      </Helmet>
      <SiteHeader />
      <main className="content-container flex flex-1 flex-col gap-lg py-xxl">
        <header className="flex flex-col gap-xxs">
          <h1 className="font-display text-display-md text-ink">Support</h1>
          <p className="text-body-md text-muted-foreground">
            Chat with our team about your registrations, payments, or anything else.
          </p>
        </header>
        <SupportPanel variant="page" />
      </main>
      <SiteFooter />
    </div>
  );
}
