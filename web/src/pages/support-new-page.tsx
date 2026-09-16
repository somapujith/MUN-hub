import { Helmet } from "react-helmet-async";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { SupportForm } from "@/components/support/support-form";

export function SupportNewPage() {

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>Contact Support</title>
        <meta name="description" content="File a support ticket — our team will follow up." />
      </Helmet>
      <SiteHeader />
      <main className="flex-1 bg-surface-soft/60">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-lg px-md py-xxl">
          <header className="flex flex-col gap-xxs">
            <h1 className="font-display text-display-md text-ink">Contact Support</h1>
            <p className="text-body-md text-muted-foreground">
              Tell us what&apos;s going on and our team will follow up by email.
            </p>
          </header>
          <SupportForm />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
