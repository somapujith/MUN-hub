import { redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { LifeBuoyIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RegistrationCard } from "@/components/dashboard/registration-card";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { getSession } from "@/app/lib/session";
import { getPastRegistrations, getUpcomingRegistrations } from "@/lib/actions/student-dashboard";
import { isProfileComplete } from "@/lib/actions/student-profile";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your dashboard",
  description: "Your MUN registrations, payment status and upcoming conferences.",
};

// Session-scoped reads — never cache or statically prerender this page.
export const dynamic = "force-dynamic";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login?redirectTo=/dashboard");
  }

  // getSession() intentionally returns only { userId, role } — the display name
  // is read here rather than widened into the frozen auth contract.
  const [user] = await db
    .select({ name: users.name, institution: users.institution })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  const [upcoming, past, profileComplete] = await Promise.all([
    getUpcomingRegistrations(session),
    getPastRegistrations(session),
    isProfileComplete(session.userId),
  ]);

  const hasAnyRegistration = upcoming.length > 0 || past.length > 0;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="content-container flex flex-1 flex-col gap-xl py-xxl">
        {!profileComplete && (
          <div className="flex flex-col gap-sm rounded-md border border-border bg-surface-soft px-md py-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body-md text-ink">
              Complete your profile to register for a MUN — emergency contact, school, and a
              few other details, just once.
            </p>
            <Button size="sm" render={<Link href="/profile?redirectTo=/dashboard" />}>
              Complete profile
            </Button>
          </div>
        )}

        {/* Page header — utility surface, no marketing band. */}
        <header className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-xxs">
            <h1 className="text-display-md text-ink">
              {user ? `Hello, ${firstName(user.name)}` : "Your dashboard"}
            </h1>
            <p className="text-body-md text-muted-foreground">
              {user?.institution
                ? `${user.institution} · Your registrations and payment status.`
                : "Your registrations and payment status."}
            </p>
          </div>

          <div className="flex items-center gap-sm">
            <Button variant="ghost" size="sm" render={<Link href="/dashboard/support" />}>
              <LifeBuoyIcon className="size-4" strokeWidth={1.75} aria-hidden />
              Support
            </Button>
            <Button variant="outline" render={<Link href="/muns" />}>
              Browse MUNs
            </Button>
          </div>
        </header>

        <Separator />

        {!hasAnyRegistration ? (
          <DashboardEmptyState
            title="No registrations yet"
            description="Once you register for a MUN it shows up here with its status, fee and payment state."
            action={{ label: "Browse MUNs", href: "/muns" }}
          />
        ) : (
          <div className="flex flex-col gap-xxl">
            <section className="flex flex-col gap-md" aria-labelledby="upcoming-heading">
              <div className="flex items-baseline gap-xs">
                <h2 id="upcoming-heading" className="text-title-lg text-ink">
                  Upcoming
                </h2>
                <span className="text-body-md tabular-nums text-muted-foreground">
                  {upcoming.length}
                </span>
              </div>

              {upcoming.length === 0 ? (
                <DashboardEmptyState
                  title="Nothing upcoming"
                  description="You have no registrations for conferences that haven't started yet."
                  action={{ label: "Browse MUNs", href: "/muns" }}
                />
              ) : (
                <ul className="flex flex-col gap-sm">
                  {upcoming.map((registration) => (
                    <li key={registration.id}>
                      <RegistrationCard registration={registration} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {past.length > 0 && (
              <section className="flex flex-col gap-md" aria-labelledby="past-heading">
                <div className="flex items-baseline gap-xs">
                  <h2 id="past-heading" className="text-title-lg text-ink">
                    Past
                  </h2>
                  <span className="text-body-md tabular-nums text-muted-foreground">
                    {past.length}
                  </span>
                </div>

                <ul className="flex flex-col gap-sm">
                  {past.map((registration) => (
                    <li key={registration.id}>
                      <RegistrationCard registration={registration} muted />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
