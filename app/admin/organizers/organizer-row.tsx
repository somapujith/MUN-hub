"use client";

import { Badge } from "@/components/ui/badge";
import type { OrganizerRow as OrganizerRowType } from "@/lib/actions/organizer-admin";
import { SuspendDialog } from "./suspend-dialog";

/** Absolute suspended-at date, ops scans this for staleness. */
function formatSuspendedAt(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * One organizer row. Server-renderable data, client only for the confirm
 * dialog — same split as `ReviewQueueRow` (app/admin/review/review-queue-row.tsx).
 */
export function OrganizerRow({ organizer }: { organizer: OrganizerRowType }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-sm p-md">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-xs">
          <p className="truncate font-display text-title-sm font-medium text-ink">
            {organizer.name}
          </p>
          {organizer.suspended && <Badge variant="destructive">Suspended</Badge>}
        </div>
        <span className="truncate text-body-md text-muted-foreground">{organizer.email}</span>
        {organizer.suspended && (
          <p className="text-body-md text-destructive-text">
            {organizer.suspendedReason || "No reason recorded"}
            {organizer.suspendedAt && ` · ${formatSuspendedAt(organizer.suspendedAt)}`}
          </p>
        )}
      </div>

      <SuspendDialog organizer={organizer} />
    </div>
  );
}
