import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/auth/session";
import { searchRegistrations } from "@/lib/actions/admin-search";
import { SearchForm } from "./search-form";

export const metadata: Metadata = {
  title: "Registrations",
  description: "Admin search across student registrations.",
};

const REVIEW_ROLES = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"] as const;

/**
 * Read-only registration search — PRD section 24. The page redirects for
 * UX, the underlying action (searchRegistrations -> requireRole) is the
 * real boundary. Same pattern as /admin/organizers and /admin/review.
 */
export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/admin/registrations")}`);
  }
  if (!REVIEW_ROLES.includes(session.role as (typeof REVIEW_ROLES)[number])) {
    redirect("/");
  }

  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const results = query ? await searchRegistrations(query) : [];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <header className="flex flex-col gap-xxs border-b border-border pb-lg">
            <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
              Operations
            </span>
            <h1 className="font-display text-display-md text-ink">Registrations</h1>
            <p className="text-body-md text-muted-foreground">
              Search by student name, MUN, committee, portfolio, or payment order ID.
            </p>
          </header>

          <SearchForm initialQuery={query} />

          {query && results.length === 0 ? (
            <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-section text-center">
              <SearchIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
              <p className="font-display text-title-md text-ink">No matches.</p>
              <p className="max-w-sm text-body-md text-muted-foreground">
                Try a different name, MUN, or order ID.
              </p>
            </div>
          ) : (
            results.length > 0 && (
              <div className="divide-y divide-border rounded-md border border-border bg-card">
                {results.map((r) => (
                  <div key={r.registrationId} className="flex flex-wrap items-center justify-between gap-sm p-md">
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="truncate font-display text-title-sm font-medium text-ink">
                        {r.studentName} — {r.munName}
                      </p>
                      <span className="truncate text-body-md text-muted-foreground">
                        {r.committeeName ?? "—"} / {r.portfolioName ?? "—"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-xs">
                      <Badge variant="outline">{r.registrationStatus}</Badge>
                      <Badge variant={r.paymentStatus === "PAID" ? "success" : "secondary"}>
                        {r.paymentStatus ?? "no payment"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
