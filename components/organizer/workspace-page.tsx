import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * Standard content frame for every workspace section. Module agents should
 * wrap their page in this rather than re-inventing padding and a heading —
 * that's what keeps 17 independently-built sections looking like one product.
 *
 * Density is deliberate: `px-md py-lg` at mobile widening to `px-xl py-xl`,
 * not the marketing site's 96px `content-container` rhythm. A workspace is
 * read as a dense instrument panel; the editorial 96px band belongs on pages
 * that are selling something.
 *
 * `actions` sits opposite the title and wraps below it on narrow screens
 * rather than squeezing the heading.
 */

interface WorkspacePageProps {
  title: string;
  description?: string;
  /** Primary/secondary buttons for this section, right-aligned on the header. */
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
        "flex w-full max-w-[86rem] flex-1 flex-col gap-lg px-md py-lg sm:px-lg xl:px-xl xl:py-xl",
        className,
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-sm">
        <div className="flex min-w-0 flex-col gap-xxs">
          <h1 className="font-display text-title-lg text-balance text-ink">
            {title}
          </h1>
          {description && (
            <p className="max-w-prose text-body-md text-pretty text-body dark:text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-xs">
            {actions}
          </div>
        )}
      </header>

      {children}
    </div>
  );
}
