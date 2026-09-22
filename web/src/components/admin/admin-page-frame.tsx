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
        <div className="content-container flex flex-col gap-lg py-xl sm:py-xxl">
          <header className="relative flex flex-col gap-xxs overflow-hidden rounded-lg bg-surface-dark p-lg text-on-dark sm:p-xl">
            <div aria-hidden className="absolute -top-16 -right-10 size-48 rounded-full border border-white/10 bg-white/5" />
            <span className="text-[12px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
              Operations
            </span>
            <h1 className="relative font-display text-display-md text-on-dark">{title}</h1>
            <p className="relative max-w-2xl break-words text-body-md text-on-dark/70">{description}</p>
          </header>
          {children}
        </div>
      </main>
    </>
  );
}
