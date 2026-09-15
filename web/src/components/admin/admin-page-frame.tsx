import type { ReactNode } from "react";
import { Helmet } from "react-helmet-async";

interface AdminPageFrameProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function AdminPageFrame({ title, description, children }: AdminPageFrameProps) {
  return (
    <>
      <Helmet title={title} />
      <main className="flex-1 bg-surface-soft/60">
        <div className="content-container flex flex-col gap-lg py-xl">
          <header className="flex flex-col gap-xxs border-b border-border pb-lg">
            <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
              Operations
            </span>
            <h1 className="font-display text-display-md text-ink">{title}</h1>
            <p className="text-body-md text-muted-foreground">{description}</p>
          </header>
          {children}
        </div>
      </main>
    </>
  );
}
