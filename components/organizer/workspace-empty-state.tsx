import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "This section works, there is just nothing in it yet" — for built workspace
 * modules whose data set is legitimately empty.
 *
 * NOT interchangeable with `./module-placeholder.tsx`, which says "this module
 * isn't built yet". Reusing that one for a MUN with zero delegates would tell
 * an organizer their Registrations page is unfinished when it is working
 * perfectly and simply has no rows. Same visual frame so the workspace reads
 * as one product; different sentence, which is the whole point.
 *
 * Sibling of `components/dashboard/dashboard-empty-state.tsx` (the student
 * side). Kept separate rather than shared because that one hardcodes a compass
 * icon and marketplace-shaped copy, and lives in the student dashboard's
 * folder; this one takes the section's own sidebar icon so the empty state
 * still identifies which section you are looking at.
 */

interface WorkspaceEmptyStateProps {
  /** Usually the section's own icon from `nav-config.ts`. */
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional recovery path — e.g. clearing filters. Omit for a calm dead end. */
  action?: { label: string; href: string };
}

export function WorkspaceEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: WorkspaceEmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-md rounded-md border border-dashed border-border bg-surface-soft px-lg py-xxl text-center dark:bg-card">
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground"
      >
        <Icon className="size-4" strokeWidth={1.5} />
      </span>

      {/* Explicit ch width, not `max-w-md`: the spacing scale shadows
          Tailwind's max-width t-shirt sizes, so `max-w-md` would resolve to
          16px. Same trap documented in dashboard-empty-state.tsx. */}
      <div className="flex max-w-[46ch] flex-col gap-xxs">
        <p className="font-display text-title-sm text-ink">{title}</p>
        <p className="text-body-md text-pretty text-muted-foreground">{description}</p>
      </div>

      {action && (
        <Button variant="outline" size="sm" render={<Link href={action.href} />}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
