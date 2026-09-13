import type { LucideIcon } from "lucide-react";

/**
 * Standing-in panel for a workspace section whose module hasn't been built.
 *
 * Reads as a deliberate "not yet", not a broken page: the section still gets
 * its real `<h1>` and its real sidebar icon, so the shell's information
 * architecture is legible before any of the content exists. A blank page here
 * would make the whole workspace look half-wired during the build-out.
 *
 * Delete the `<ModulePlaceholder>` call, keep the `<WorkspacePage>` header
 * around it — that header is the section's permanent chrome.
 */

interface ModulePlaceholderProps {
  icon: LucideIcon;
  /** One sentence on what this module will do. Not a roadmap. */
  description: string;
}

export function ModulePlaceholder({
  icon: Icon,
  description,
}: ModulePlaceholderProps) {
  return (
    <div className="flex flex-col items-center gap-md rounded-md border border-dashed border-border bg-surface-soft px-lg py-xxl text-center dark:bg-card">
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-surface-strong text-muted-foreground dark:bg-muted"
      >
        <Icon strokeWidth={1.5} className="size-5" />
      </span>
      <div className="flex max-w-prose flex-col gap-xs">
        <p className="font-display text-title-sm text-ink">
          This module isn&rsquo;t built yet
        </p>
        <p className="text-body-md text-pretty text-body dark:text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
