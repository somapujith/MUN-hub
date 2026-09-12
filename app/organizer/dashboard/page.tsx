import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRightIcon, ClockIcon, PlusIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { getOrganizerDashboard } from "./queries";
import { OrganizerMunCard } from "./organizer-mun-card";

export const metadata: Metadata = {
  title: "Organizer dashboard",
  robots: { index: false },
};

/** Roles allowed to view an organizer workspace. Ops roles see their own only. */
const ALLOWED_ROLES = new Set(["ORGANIZER", "ADMIN", "SUPER_ADMIN"]);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-xxs rounded-md border border-border bg-card p-md">
      <dt className="text-body-md text-muted-foreground">{label}</dt>
      <dd className="font-display text-display-md tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export default async function OrganizerDashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login?redirectTo=/organizer/dashboard");
  }
  if (!ALLOWED_ROLES.has(session.role)) {
    redirect("/");
  }

  const { muns, totals, application } = await getOrganizerDashboard(session.userId);

  // Application submitted but no mun has been created for it yet — the only
  // state where there's genuinely nothing to show but applying again is wrong.
  const awaitingReview = muns.length === 0 && application !== null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 pb-section">
        <div className="content-container flex flex-col gap-xl py-xxl">
          <header className="flex flex-wrap items-end justify-between gap-md">
            <div className="flex flex-col gap-xxs">
              <p className="text-caption text-muted-foreground">Organizer</p>
              <h1 className="font-display text-display-md text-balance text-ink">
                Your conferences
              </h1>
            </div>

            {!application && (
              <Button render={<Link href="/organizer/apply" />}>
                <PlusIcon aria-hidden strokeWidth={1.75} />
                Apply to host a MUN
              </Button>
            )}
          </header>

          {muns.length > 0 && (
            <dl className="grid gap-md sm:grid-cols-3">
              <Stat label="Conferences" value={totals.munCount.toLocaleString("en-IN")} />
              <Stat label="Live listings" value={totals.liveCount.toLocaleString("en-IN")} />
              <Stat
                label="Total registrations"
                value={totals.registrationCount.toLocaleString("en-IN")}
              />
            </dl>
          )}

          {muns.length > 0 ? (
            <section aria-label="Your conferences" className="grid gap-md lg:grid-cols-2">
              {muns.map((mun) => (
                <OrganizerMunCard key={mun.id} mun={mun} />
              ))}
            </section>
          ) : awaitingReview ? (
            <section className="flex flex-col items-start gap-md rounded-md border border-border bg-surface-soft p-xl dark:bg-card">
              <span
                aria-hidden
                className="flex size-10 items-center justify-center rounded-full bg-info/15 text-info-text"
              >
                <ClockIcon strokeWidth={1.75} className="size-5" />
              </span>
              <div className="flex max-w-prose flex-col gap-xs">
                <h2 className="font-display text-title-sm text-ink">Application under review</h2>
                <p className="text-body-md text-body text-pretty dark:text-muted-foreground">
                  We received your application on{" "}
                  {new Intl.DateTimeFormat("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }).format(application.submittedAt)}
                  . Once it&rsquo;s approved, your conference will appear here and you can start
                  building out committees and pricing.
                </p>
              </div>
            </section>
          ) : (
            <section className="flex flex-col items-start gap-md rounded-md border border-dashed border-border bg-surface-soft p-xl dark:bg-card">
              <div className="flex max-w-prose flex-col gap-xs">
                <h2 className="font-display text-title-lg text-balance text-ink">
                  No conferences yet
                </h2>
                <p className="text-body-md text-body text-pretty dark:text-muted-foreground">
                  Apply to host a MUN and, once approved, you&rsquo;ll manage committees,
                  registrations, and payments right here.
                </p>
              </div>
              <Button size="lg" render={<Link href="/organizer/apply" />}>
                Apply to host a MUN
                <ArrowRightIcon aria-hidden strokeWidth={1.75} />
              </Button>
            </section>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
