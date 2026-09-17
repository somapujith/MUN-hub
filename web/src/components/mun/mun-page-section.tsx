import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * One titled band of the public MUN page. `scroll-mt` clears the sticky site
 * header (64px) plus the sticky in-page section nav, so an anchor jump lands
 * with the heading visible. The heading is programmatically focusable so the
 * section nav can move keyboard focus along with the scroll.
 */

/** Sticky header (64px) + section nav (~53px) + breathing room. */
export const SECTION_SCROLL_OFFSET_PX = 136;

interface MunPageSectionProps {
  id: string;
  title: string;
  description?: ReactNode;
  /** Right-aligned meta beside the heading (counts, a secondary link). */
  aside?: ReactNode;
  children: ReactNode;
}

export function MunPageSection({ id, title, description, aside, children }: MunPageSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-[136px]">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h2
          id={`${id}-heading`}
          tabIndex={-1}
          className="font-display text-title-lg font-normal text-ink outline-none md:text-display-md"
        >
          {title}
        </h2>
        {aside}
      </div>
      {description && (
        <p className="mt-xs max-w-[65ch] text-body-md text-pretty text-muted-foreground">{description}</p>
      )}
      <div className="mt-lg">{children}</div>
    </section>
  );
}

/** Dashed placeholder for a section the organizer hasn't filled in yet. */
export function SectionEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
      <p className="text-body-md text-muted-foreground">{children}</p>
    </div>
  );
}

export function SectionError({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-body-md text-destructive-text">
      {children}
    </p>
  );
}

/** Generic loading placeholder: a few card-shaped blocks. */
export function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-sm">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-md" />
      ))}
    </div>
  );
}
