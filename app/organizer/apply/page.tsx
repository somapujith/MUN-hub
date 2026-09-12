import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { organizerApplications } from "@/lib/db/schema";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = {
  title: "Host a MUN",
  description:
    "Apply to list your Model United Nations conference on MUN Hub — reach verified delegates and manage registrations in one place.",
};

const STEPS = [
  "Submit this application",
  "Our team reviews it within 5 business days",
  "Build out committees, portfolios and pricing",
  "Go live and open registration",
];

export default async function OrganizerApplyPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login?redirectTo=/organizer/apply");
  }

  // `organizer_applications.organizer_id` is UNIQUE — one per organizer, ever.
  // Rendering the form for someone who already applied would guarantee a
  // constraint error on submit, so route them to the dashboard instead.
  const [existing] = await db
    .select({ id: organizerApplications.id })
    .from(organizerApplications)
    .where(eq(organizerApplications.organizerId, session.userId))
    .limit(1);

  if (existing) {
    redirect("/organizer/dashboard");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 pb-section">
        <div className="content-container">
          <div className="grid gap-xl py-xxl lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-section lg:py-section">
            <div className="flex max-w-2xl flex-col gap-xl">
              <header className="flex flex-col gap-md">
                <p className="text-caption text-muted-foreground">For organizers</p>
                <h1 className="font-display text-display-md text-balance text-ink lg:text-display-lg">
                  Host your MUN on MUN Hub
                </h1>
                <p className="text-title-md text-body text-pretty dark:text-muted-foreground">
                  Tell us about your conference. Once approved, you&rsquo;ll get a public listing,
                  a delegate roster, and payments handled end to end.
                </p>
              </header>

              <ApplyForm />
            </div>

            <aside>
              <div className="flex flex-col gap-md rounded-md border border-border bg-surface-soft p-lg lg:sticky lg:top-24 dark:bg-card">
                <h2 className="font-display text-label-md text-ink">What happens next</h2>
                <ol className="flex flex-col gap-sm">
                  {STEPS.map((step, index) => (
                    <li key={step} className="flex items-start gap-sm text-body-md text-body dark:text-muted-foreground">
                      <span
                        aria-hidden
                        className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-legal tabular-nums text-muted-foreground"
                      >
                        {index + 1}
                      </span>
                      <span className="text-pretty">{step}</span>
                    </li>
                  ))}
                </ol>

                <p className="flex items-start gap-xs border-t border-border pt-md text-body-md text-muted-foreground text-pretty">
                  <CheckIcon aria-hidden strokeWidth={1.75} className="mt-px size-3.5 shrink-0 text-success-text" />
                  No listing fee. You keep control of pricing and capacity.
                </p>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  render={<Link href="/muns" />}
                >
                  Browse live conferences
                  <ArrowRightIcon aria-hidden strokeWidth={1.75} />
                </Button>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
