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
        "flex w-full max-w-[86rem] flex-1 flex-col gap-lg px-md py-lg sm:px-lg xl:px-xl xl:py-xl",
        className,
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-sm">
        <div className="flex min-w-0 flex-col gap-xxs">
          <h1 className="font-display text-title-lg text-balance text-ink">{title}</h1>
          {description && (
            <p className="max-w-prose text-body-md text-pretty text-body dark:text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-xs">{actions}</div>
        )}
      </header>
      {children}
    </div>
  );
}
