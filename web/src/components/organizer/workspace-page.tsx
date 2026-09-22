import type { ReactNode } from "react";
import { cn } from "cn";

interface WorkspacePageProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function WorkspacePage({
  title,
  description,
  actions,
  children,
  className,
}: WorkspacePageProps) {
  return (
    <div
      className={cn(
        // Bottom padding clears the floating support button, so it never
        // covers a page's last action (e.g. a form's Save button).
        "mx-auto flex w-full max-w-[86rem] flex-1 flex-col gap-lg px-md pt-lg pb-24 sm:px-lg xl:px-xl xl:pt-xl",
        className,
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-sm rounded-lg border border-border/80 bg-background p-lg elevated-card">
        <div className="flex min-w-0 flex-col gap-xxs">
          <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">Organizer workspace</p>
          <h1 className="font-display text-display-md text-balance text-ink">{title}</h1>
          {description && (
            <p className="max-w-prose text-body-md text-pretty text-body dark:text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          // shrink-0 only from `sm` up: below that, the title block already takes
          // the full width of its own wrapped line, so this group is alone on its
          // line too and needs to be free to shrink (and let its own flex-wrap
          // apply) instead of forcing a fixed content width past a narrow
          // viewport (e.g. a status badge + button together at 320px).
          <div className="flex flex-wrap items-center gap-xs sm:shrink-0">{actions}</div>
        )}
      </header>
      {children}
    </div>
  );
}
