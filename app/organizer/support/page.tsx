import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { getSession } from "@/app/lib/session";
import { SupportPanel } from "@/components/support/support-panel";

export const metadata: Metadata = {
  title: "Support",
  description: "Chat with the MUN Hub support team.",
};

// Session-scoped read (redirect-if-no-session) — never cache or statically
// prerender this page, same as /support/new and /admin/support.
export const dynamic = "force-dynamic";

/**
 * Organizer-account-level support inbox — full-page chat with the MUN Hub
 * team, not tied to any one MUN. Lives as a top-level sibling of
 * /organizer/apply (not under /organizer/dashboard/**, which has its own
 * per-MUN workspace chrome). Admins reviewing tickets use /admin/support
 * instead, which is a separate page.
 */
export default async function OrganizerSupportPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/organizer/support")}`);
  }
  if (session.role !== "ORGANIZER") {
    redirect("/");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <header className="flex flex-col gap-xxs border-b border-border pb-lg">
            <h1 className="font-display text-display-md text-ink">Support</h1>
            <p className="text-body-md text-muted-foreground">
              Chat with our team about your MUN listing, payments, or anything else.
            </p>
          </header>

          <SupportPanel role="ORGANIZER" variant="page" />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
