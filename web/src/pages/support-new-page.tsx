import { Helmet } from "react-helmet-async";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { SupportForm } from "@/components/support/support-form";
import { SupportRedirect } from "@/components/support/support-redirect";
import { useSession } from "@/hooks/use-session";
import { resolveZoneUrl } from "@/lib/host-routing";

const STAFF_ROLES = new Set(["OPERATIONS", "ADMIN", "SUPER_ADMIN"]);

/** /support/new — the full support form. Route-guarded by RequireAuth. */
export function SupportNewPage() {
  const { data: session } = useSession();
  if (session && STAFF_ROLES.has(session.role)) return <SupportRedirect url={resolveZoneUrl("admin", "/admin/support")} />;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>Contact support | MUN Hub</title>
        <meta name="description" content="Open a support ticket with the MUN Hub team." />
      </Helmet>
      <SiteHeader />
      <main className="flex-1 bg-surface-soft/60">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-lg px-md py-xxl">
          <header className="flex flex-col gap-xxs">
            <h1 className="font-display text-display-md text-ink">Contact Support</h1>
            <p className="text-body-md text-muted-foreground">
              Tell us what&apos;s going on. Your ticket opens as a conversation in your support inbox, and our reply
              arrives there.
            </p>
          </header>
          <SupportForm />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
