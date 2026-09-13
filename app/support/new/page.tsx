import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { getSession } from "@/lib/auth/session";
import { SupportForm } from "./support-form";

export const metadata: Metadata = {
  title: "Contact Support",
  description: "File a support ticket — our team will follow up.",
};

// Session-scoped read (redirect-if-no-session) — never cache or statically
// prerender this page, same as /register/[slug] and /dashboard.
export const dynamic = "force-dynamic";

/**
 * Student/organizer-facing "contact support" entry. `createTicket` throws
 * Forbidden without a session, so bounce to sign-in *before* rendering a
 * form the user can't submit — same auth-gate pattern as
 * `app/register/[slug]/page.tsx` and `app/dashboard/page.tsx`.
 */
export default async function NewSupportTicketPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/support/new")}`);
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
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
