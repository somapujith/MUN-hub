import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { AwardIcon, BadgeCheckIcon, CalendarIcon, ClockIcon, DownloadIcon, FileBadgeIcon, MapPinIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { formatDateRange } from "@/components/shared/date-range";
import { queryKeys } from "@/api/query-keys";
import { fetchMyCredentials } from "@/api/credentials";
import { useScrollToTop } from "@/hooks/use-scroll-to-top";
import type { MyAchievement, MyCertificate } from "@/types/credentials";

function formatIssuedDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function CredentialsSkeleton() {
  return (
    <main className="content-container flex flex-1 flex-col gap-xl py-xxl">
      <Skeleton className="h-9 w-[min(100%,20rem)] rounded-sm" />
      <Skeleton className="h-[120px] w-full rounded-md" />
      <Skeleton className="h-[120px] w-full rounded-md" />
    </main>
  );
}

/** Where and when the conference took place, e.g. "12 – 14 Mar 2027 · Hyderabad". */
function ConferenceMeta({
  city,
  start,
  end,
}: {
  city: string | null;
  start: Date | null;
  end: Date | null;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-md gap-y-xxs text-body-md text-muted-foreground">
      <span className="inline-flex items-center gap-xxs">
        <CalendarIcon aria-hidden className="size-3.5" />
        {formatDateRange(start, end)}
      </span>
      {city && (
        <span className="inline-flex items-center gap-xxs">
          <MapPinIcon aria-hidden className="size-3.5" />
          {city}
        </span>
      )}
    </p>
  );
}

function AchievementCard({ achievement }: { achievement: MyAchievement }) {
  const seat = [achievement.committee, achievement.portfolio].filter(Boolean).join(" · ");
  return (
    <Card>
      <CardContent className="flex items-start gap-md">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success/12 text-success-text"
        >
          <AwardIcon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-xs">
          <div className="flex flex-wrap items-center gap-xs">
            <h3 className="font-display text-title-sm text-ink">{achievement.award ?? "Award"}</h3>
            <Badge variant="success">
              <BadgeCheckIcon aria-hidden />
              Verified
            </Badge>
          </div>
          <p className="text-body-md text-ink">{achievement.munName}</p>
          {seat && <p className="text-body-md text-muted-foreground">{seat}</p>}
          <ConferenceMeta city={achievement.city} start={achievement.munStartDate} end={achievement.munEndDate} />
        </div>
      </CardContent>
    </Card>
  );
}

function CertificateCard({ certificate }: { certificate: MyCertificate }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between sm:gap-lg">
        <div className="flex min-w-0 items-start gap-md">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-info/12 text-info-text"
          >
            <FileBadgeIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-xs">
            <div className="flex flex-wrap items-center gap-xs">
              <h3 className="font-display text-title-sm text-ink">{certificate.munName}</h3>
              {certificate.verified ? (
                <Badge variant="success">
                  <BadgeCheckIcon aria-hidden />
                  Verified
                </Badge>
              ) : (
                <Badge variant="outline">
                  <ClockIcon aria-hidden />
                  Awaiting verification
                </Badge>
              )}
            </div>
            <ConferenceMeta city={certificate.city} start={certificate.munStartDate} end={certificate.munEndDate} />
            <p className="text-caption text-muted-foreground">Issued {formatIssuedDate(certificate.issuedAt)}</p>
          </div>
        </div>
        {certificate.downloadUrl ? (
          <Button
            variant="outline"
            className="shrink-0 self-start"
            render={<a href={certificate.downloadUrl} target="_blank" rel="noopener noreferrer" download />}
          >
            <DownloadIcon aria-hidden />
            Download
            <span className="sr-only"> certificate for {certificate.munName}</span>
          </Button>
        ) : (
          <p className="shrink-0 text-body-md text-muted-foreground">File not available yet</p>
        )}
      </CardContent>
    </Card>
  );
}

function SectionHeading({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-xs">
      <h2 id={id} className="text-title-lg text-ink">
        {title}
      </h2>
      <span className="text-body-md tabular-nums text-muted-foreground">{count}</span>
    </div>
  );
}

/**
 * The delegate's verified conference record: awards MUN Hub has approved, and
 * certificates organizers have issued to them. Read-only — a delegate can't
 * add or edit either (see lib/actions/student-credentials.ts).
 */
export function CredentialsPage() {
  useScrollToTop();

  const credentialsQuery = useQuery({
    queryKey: queryKeys.credentials(),
    queryFn: fetchMyCredentials,
  });

  const achievements = credentialsQuery.data?.achievements ?? [];
  const certificates = credentialsQuery.data?.certificates ?? [];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>Certificates &amp; achievements | MUN Hub</title>
      </Helmet>
      <SiteHeader />
      {credentialsQuery.isPending ? (
        <CredentialsSkeleton />
      ) : (
        <main className="content-container flex flex-1 flex-col gap-xl py-xxl">
          <header className="flex flex-col gap-xxs">
            <h1 className="text-display-md text-ink">Certificates &amp; achievements</h1>
            <p className="text-body-md text-muted-foreground">
              Your verified conference record. Awards appear once MUN Hub has approved a conference's results.
            </p>
          </header>
          <Separator />
          {credentialsQuery.isError ? (
            <div role="alert" className="flex flex-col items-start gap-sm rounded-md border border-border p-lg">
              <p className="text-body-md text-destructive-text">
                {credentialsQuery.error instanceof Error
                  ? credentialsQuery.error.message
                  : "We couldn't load your certificates and achievements."}
              </p>
              <Button variant="outline" onClick={() => void credentialsQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-xxl">
              <section className="flex flex-col gap-md" aria-labelledby="achievements-heading">
                <SectionHeading id="achievements-heading" title="Achievements" count={achievements.length} />
                {achievements.length === 0 ? (
                  <DashboardEmptyState
                    title="No verified awards yet"
                    description="Awards you win at a conference show up here once MUN Hub approves that conference's results."
                  />
                ) : (
                  <ul className="flex flex-col gap-sm">
                    {achievements.map((achievement) => (
                      <li key={achievement.id}>
                        <AchievementCard achievement={achievement} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="flex flex-col gap-md" aria-labelledby="certificates-heading">
                <SectionHeading id="certificates-heading" title="Certificates" count={certificates.length} />
                {certificates.length === 0 ? (
                  <DashboardEmptyState
                    title="No certificates yet"
                    description="When an organizer issues you a certificate for a conference you attended, you can download it here."
                  />
                ) : (
                  <ul className="flex flex-col gap-sm">
                    {certificates.map((certificate) => (
                      <li key={certificate.id}>
                        <CertificateCard certificate={certificate} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </main>
      )}
      <SiteFooter />
    </div>
  );
}
