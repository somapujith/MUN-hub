import { Link } from "react-router";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RegistrationCard } from "@/components/dashboard/registration-card";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardSkeleton } from "@/pages/dashboard/DashboardSkeleton";
import { queryKeys } from "@/api/query-keys";
import { fetchPastRegistrations, fetchUpcomingRegistrations } from "@/mocks/registrations";
import { fetchMockUserProfile } from "@/mocks/session";
import { useSession } from "@/hooks/use-session";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

export function StudentDashboardPage() {
  const { data: session } = useSession();
  const profileQuery = useQuery({
    queryKey: queryKeys.userProfile(session?.userId ?? ""),
    queryFn: () => fetchMockUserProfile(session!.userId),
    enabled: Boolean(session),
  });
  const upcomingQuery = useQuery({
    queryKey: queryKeys.dashboardUpcoming(),
    queryFn: fetchUpcomingRegistrations,
  });
  const pastQuery = useQuery({
    queryKey: queryKeys.dashboardPast(),
    queryFn: fetchPastRegistrations,
  });

  const loading = profileQuery.isPending || upcomingQuery.isPending || pastQuery.isPending;
  const upcoming = upcomingQuery.data ?? [];
  const past = pastQuery.data ?? [];
  const user = profileQuery.data;
  const hasAny = upcoming.length > 0 || past.length > 0;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>Your dashboard</title>
      </Helmet>
      <SiteHeader session={session ?? null} />
      {loading ? (
        <DashboardSkeleton />
      ) : (
        <main className="content-container flex flex-1 flex-col gap-xl py-xxl">
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
            <Button variant="outline" render={<Link to="/muns" />}>
              Browse MUNs
            </Button>
          </header>
          <Separator />
          {!hasAny ? (
            <DashboardEmptyState
              title="No registrations yet"
              description="Once you register for a MUN it shows up here with its status, fee and payment state."
              action={{ label: "Browse MUNs", href: "/muns" }}
            />
          ) : (
            <div className="flex flex-col gap-xxl">
              <section className="flex flex-col gap-md" aria-labelledby="upcoming-heading">
                <div className="flex items-baseline gap-xs">
                  <h2 id="upcoming-heading" className="text-title-lg text-ink">Upcoming</h2>
                  <span className="text-body-md tabular-nums text-muted-foreground">{upcoming.length}</span>
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
                    <h2 id="past-heading" className="text-title-lg text-ink">Past</h2>
                    <span className="text-body-md tabular-nums text-muted-foreground">{past.length}</span>
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
      )}
      <SiteFooter />
    </div>
  );
}
