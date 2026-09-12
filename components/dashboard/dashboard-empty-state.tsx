import Link from "next/link";
import { CompassIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DashboardEmptyStateProps {
  title: string;
  description: string;
  /** Omit to render a quiet, CTA-less empty slot (e.g. the "past" tab). */
  action?: { label: string; href: string };
}

export function DashboardEmptyState({
  title,
  description,
  action,
}: DashboardEmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-md rounded-md border border-dashed border-border bg-surface-soft px-lg py-xxl text-center">
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground"
      >
        <CompassIcon className="size-4" strokeWidth={1.75} />
      </span>

      {/* NOTE: not `max-w-md` — the design system's `--spacing-md` token
          shadows Tailwind's max-width t-shirt scale, so `max-w-md` resolves to
          16px, not 448px. Use an explicit length for any max-width below 2xl. */}
      <div className="flex max-w-[42ch] flex-col gap-xxs">
        <p className="font-display text-title-sm text-ink">{title}</p>
        <p className="text-body-md text-muted-foreground">{description}</p>
      </div>

      {action && (
        <Button render={<Link href={action.href} />}>{action.label}</Button>
      )}
    </div>
  );
}
