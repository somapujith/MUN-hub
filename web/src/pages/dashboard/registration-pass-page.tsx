import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Link, useParams } from "react-router";
import { ArrowLeftIcon, CalendarIcon, CircleCheck, MapPinIcon, PrinterIcon, TicketIcon } from "lucide-react";
import { CheckInApiError, checkInKeys, getRegistrationPass } from "@/api/check-in";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { formatDateRange } from "@/components/shared/date-range";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useScrollToTop } from "@/hooks/use-scroll-to-top";

/**
 * A delegate's conference pass: where and when, their seat, and the check-in
 * code the organizer's desk types or scans. Only the delegate who owns the
 * registration can load it (the API answers "not found" to anyone else).
 *
 * There's no QR code yet — no QR library ships with the app — so the code is
 * shown large enough to read out or type.
 */
export function RegistrationPassPage() {
  const { registrationId = "" } = useParams();
  // See use-scroll-to-top.ts — commonly reached via "View your pass" on the
  // (often tall, scrolled-down) registration confirmation page.
  useScrollToTop();
  const passQuery = useQuery({
    queryKey: checkInKeys.pass(registrationId),
    queryFn: () => getRegistrationPass(registrationId),
    enabled: Boolean(registrationId),
    retry: false,
  });
  const pass = passQuery.data;

  const location = pass
    ? [pass.mun.venue, pass.mun.addressLine1, pass.mun.city, pass.mun.state, pass.mun.country]
        .filter(Boolean)
        .join(", ")
    : "";
  const seat = pass ? [pass.committee, pass.portfolio].filter(Boolean).join(" · ") : "";

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>{pass ? `Pass — ${pass.mun.name} | MUN Hub` : "Your pass | MUN Hub"}</title>
      </Helmet>
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="content-container flex flex-1 flex-col gap-lg py-xxl print:py-0">
        <div className="flex flex-wrap items-center justify-between gap-sm print:hidden">
          <Button variant="ghost" size="sm" render={<Link to="/dashboard" />}>
            <ArrowLeftIcon aria-hidden /> Your dashboard
          </Button>
          {pass && (
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <PrinterIcon aria-hidden /> Print pass
            </Button>
          )}
        </div>

        {passQuery.isPending && (
          <div className="mx-auto flex w-full max-w-[36rem] flex-col gap-md" aria-busy="true">
            <Skeleton className="h-9 w-2/3 rounded-sm" />
            <Skeleton className="h-[360px] w-full rounded-md" />
          </div>
        )}

        {passQuery.isError && (
          <div className="mx-auto w-full max-w-[36rem]">
            <DashboardEmptyState
              title={
                passQuery.error instanceof CheckInApiError && passQuery.error.status === 409
                  ? "Your pass isn't ready yet"
                  : "Pass not found"
              }
              description={
                passQuery.error instanceof CheckInApiError && passQuery.error.status === 409
                  ? passQuery.error.message
                  : "We couldn't find a pass for this registration on your account."
              }
              action={{ label: "Back to your dashboard", href: "/dashboard" }}
            />
          </div>
        )}

        {pass && (
          <Card className="mx-auto w-full max-w-[36rem] gap-0 py-0 print:border-[#181d26]">
            {/*
              Same fixed-vs-theme-aware split SignatureCard's "dark" variant
              documents: `surface-dark` is #181d26 in light mode, which is
              also this app's dark-mode canvas background — so a header
              hardcoded to #181d26 would blend invisibly into the page behind
              it in dark mode instead of reading as a card. `dark:bg-surface-strong`
              (a real step up from the dark canvas) keeps the header visible
              in both themes; `text-on-dark`/`dark:text-foreground` follow the
              same pattern for the text on top of it.
            */}
            <div className="flex flex-col gap-xs bg-surface-dark px-lg py-lg text-on-dark dark:bg-surface-strong dark:text-foreground">
              <span className="inline-flex items-center gap-xs text-caption text-on-dark/70 dark:text-foreground/70">
                <TicketIcon className="size-4" aria-hidden /> Delegate pass
              </span>
              {/* Explicit colour: the base layer paints every h1 in --ink. */}
              <h1 className="font-display text-display-md text-balance text-on-dark dark:text-foreground">{pass.mun.name}</h1>
              <p className="flex items-center gap-xs text-body-md text-on-dark/85 dark:text-foreground/85">
                <CalendarIcon className="size-4 shrink-0" aria-hidden />
                {formatDateRange(
                  pass.mun.startDate ? new Date(pass.mun.startDate) : null,
                  pass.mun.endDate ? new Date(pass.mun.endDate) : null,
                )}
              </p>
              {location && (
                <p className="flex items-start gap-xs text-body-md text-on-dark/85 dark:text-foreground/85">
                  <MapPinIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {location}
                </p>
              )}
            </div>

            <CardContent className="flex flex-col gap-lg py-lg">
              <dl className="grid gap-md sm:grid-cols-2">
                <div className="flex flex-col gap-xxs">
                  <dt className="text-caption text-muted-foreground">Delegate</dt>
                  <dd className="text-label-md text-ink">{pass.delegateName}</dd>
                </div>
                <div className="flex flex-col gap-xxs">
                  <dt className="text-caption text-muted-foreground">Pass</dt>
                  <dd className="text-label-md text-ink">{pass.passName}</dd>
                </div>
                <div className="flex flex-col gap-xxs sm:col-span-2">
                  <dt className="text-caption text-muted-foreground">Committee &amp; portfolio</dt>
                  <dd className="text-label-md text-ink">{seat || "To be allocated by the organizers"}</dd>
                </div>
              </dl>

              <div className="flex flex-col items-center gap-xs rounded-md border border-dashed border-border-strong bg-surface-soft px-md py-lg text-center">
                <span className="text-caption text-muted-foreground">Check-in code</span>
                <p className="font-mono text-[26px] leading-tight font-medium tracking-[0.12em] whitespace-nowrap text-ink sm:text-display-md sm:tracking-[0.18em]">
                  {pass.checkInCode}
                </p>
                {pass.checkedIn ? (
                  <p className="inline-flex items-center gap-xxs text-body-md text-success-text">
                    <CircleCheck className="size-4" aria-hidden /> You're checked in
                  </p>
                ) : (
                  <p className="max-w-[36ch] text-body-md text-muted-foreground">
                    Show this code at the registration desk when you arrive. Keep it to yourself — it's your entry.
                  </p>
                )}
              </div>

              <p className="text-legal text-muted-foreground">
                Registration <span className="font-mono">{pass.registrationId}</span>
              </p>
            </CardContent>
          </Card>
        )}
      </main>
      <div className="print:hidden">
        <SiteFooter />
      </div>
    </div>
  );
}
