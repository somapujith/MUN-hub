import type { Metadata } from "next";
import { ScrollTextIcon } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db/client";
import { adminActions, users } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Audit Log",
  description: "General admin action history across the platform.",
};

/**
 * General audit-log viewer — the last 100 `admin_actions` rows (append-only
 * general admin audit log), newest first, joined to the actor's name.
 *
 * This is deliberately a flat, un-scoped listing rather than a call into
 * `getAuditHistory` (in `lib/actions/audit-history.ts`): that action merges
 * `admin_actions` + `verification_logs` for one specific `(targetType,
 * targetId)` pair (e.g. one mun's full history) and is meant to be embedded
 * into a target's own detail view once one exists. This page has no single
 * target — it's the platform-wide feed — so it reads `admin_actions`
 * directly instead of round-tripping through a helper built for a different
 * shape of question.
 *
 * Role-gating happens in `app/admin/layout.tsx` (and again inside every
 * action that reads/writes admin data via `requireRole`) — this page does
 * no gating of its own.
 */
export default async function AuditLogPage() {
  const rows = await db
    .select({
      id: adminActions.id,
      action: adminActions.action,
      targetType: adminActions.targetType,
      targetId: adminActions.targetId,
      reason: adminActions.reason,
      createdAt: adminActions.createdAt,
      actorName: users.name,
    })
    .from(adminActions)
    .innerJoin(users, eq(adminActions.actorId, users.id))
    .orderBy(desc(adminActions.createdAt))
    .limit(100);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <header className="flex flex-col gap-xxs border-b border-border pb-lg">
            <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
              Operations
            </span>
            <h1 className="font-display text-display-md text-ink">Audit Log</h1>
            <p className="text-body-md text-muted-foreground">
              Most recent 100 admin actions across the platform, newest first.
            </p>
          </header>

          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-section text-center">
              <ScrollTextIcon className="size-8 text-muted-foreground" strokeWidth={1.25} aria-hidden />
              <p className="font-display text-title-md text-ink">No admin actions yet.</p>
              <p className="max-w-sm text-body-md text-muted-foreground">
                Actions like suspending an organizer or unpublishing a MUN will show up here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border bg-card">
              {rows.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-sm p-md">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate font-display text-title-sm font-medium text-ink">
                      {row.actorName}
                      {row.reason ? ` — ${row.reason}` : ""}
                    </p>
                    <span className="text-body-md text-muted-foreground">
                      {row.targetType}/{row.targetId} ·{" "}
                      {new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(row.createdAt)}
                    </span>
                  </div>
                  <Badge variant="secondary">{row.action}</Badge>
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
