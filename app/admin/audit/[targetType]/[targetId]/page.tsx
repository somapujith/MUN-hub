import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon, ScrollTextIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAuditHistory } from "@/lib/actions/audit-history";
import { getSession } from "@/app/lib/session";

export const metadata: Metadata = {
  title: "Audit History",
  description: "Full admin action + verification history for one target.",
};

// Session-scoped reads — never cache or statically prerender this page.
export const dynamic = "force-dynamic";

const REVIEW_ROLES = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"] as const;

interface AuditTargetPageProps {
  params: Promise<{ targetType: string; targetId: string }>;
}

/**
 * Per-target audit history — the real caller for `getAuditHistory`
 * (`lib/actions/audit-history.ts`), which merges `admin_actions` +
 * `verification_logs` (for targetType 'mun') for one `(targetType,
 * targetId)` pair, oldest first. Linked from each row of the flat
 * `/admin/audit` feed.
 *
 * Gate in the page as well as inside the action (defense in depth, same
 * pattern as every other admin page — see /admin/review, /admin/organizers).
 * `getAuditHistory` itself calls `requireRole`, which is the real boundary.
 */
export default async function AuditTargetPage({ params }: AuditTargetPageProps) {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent("/admin/audit")}`);
  }
  if (!REVIEW_ROLES.includes(session.role as (typeof REVIEW_ROLES)[number])) {
    redirect("/");
  }

  const { targetType, targetId } = await params;
  const entries = await getAuditHistory(targetType, targetId, session);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <header className="flex flex-col gap-xxs border-b border-border pb-lg">
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit p-0 text-muted-foreground"
              render={<Link href="/admin/audit" />}
            >
              <ArrowLeftIcon aria-hidden />
              Back to audit log
            </Button>
            <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
              Operations
            </span>
            <h1 className="font-display text-display-md text-ink">
              Audit history — {targetType}/{targetId}
            </h1>
            <p className="text-body-md text-muted-foreground">
              Every admin action and verification-log entry recorded against this target, oldest
              first.
            </p>
          </header>

          {entries.length === 0 ? (
            <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-section text-center">
              <ScrollTextIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
              <p className="font-display text-title-md text-ink">No history for this target.</p>
              <p className="max-w-sm text-body-md text-muted-foreground">
                Nothing has been recorded yet for {targetType}/{targetId}.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border bg-card">
              {entries.map((entry, i) => (
                <div
                  key={`${entry.action}-${entry.createdAt.getTime()}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-sm p-md"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate font-display text-title-sm font-medium text-ink">
                      Actor: {entry.actorId}
                      {entry.reason ? ` — ${entry.reason}` : ""}
                    </p>
                    <span className="text-body-md text-muted-foreground">
                      {new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(entry.createdAt)}
                    </span>
                  </div>
                  <Badge variant="secondary">{entry.action}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
