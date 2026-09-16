import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { SupportPanel } from "@/components/support/support-panel";
import { getSession } from "@/app/lib/session";

export const metadata: Metadata = {
  title: "Support",
  description: "Chat with the MUN Hub support team.",
};

// Session-scoped read — never cache or statically prerender this page, same
// as /support/new and /dashboard.
export const dynamic = "force-dynamic";

/**
 * Student-facing full-page support inbox — start a new conversation, view
 * past ones, send/receive messages. Role-gated to STUDENT (organizer/admin
 * get their own equivalents under /organizer/support and /admin/support).
 */
export default async function StudentSupportPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/dashboard/support")}`);
  }
  if (session.role !== "STUDENT") {
    redirect("/");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="content-container flex flex-1 flex-col gap-lg py-xxl">
        <header className="flex flex-col gap-xxs">
          <h1 className="font-display text-display-md text-ink">Support</h1>
          <p className="text-body-md text-muted-foreground">
            Chat with our team about your registrations, payments, or anything else.
          </p>
        </header>

        <SupportPanel role="STUDENT" variant="page" />
      </main>

      <SiteFooter />
    </div>
  );
}
