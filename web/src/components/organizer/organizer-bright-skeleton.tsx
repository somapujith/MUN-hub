import { cn } from "cn";

/**
 * Loading placeholders for publish.munhub.in's "bright shell" pages (apply,
 * resubmit, the onboarding wizard) — built from the same fixed light-theme
 * color as organizer-bright-shell.tsx / bright-form.tsx's hairlines
 * (`#ececf1`), deliberately NOT the shared `<Skeleton>` component. `Skeleton`
 * carries a `dark:` class that still fires when the site-wide theme is dark
 * even though this shell forces `[color-scheme:light]` with fixed hex colors
 * everywhere else — using it here would reintroduce, inside the one place
 * that specifically exists to avoid it, the exact "raw color vs.
 * theme-reactive token" mismatch this codebase has already shipped as a
 * dark-mode bug twice (see CLAUDE.md item 2 / scripts/check-hex-colors.mjs,
 * which allowlists this file's fixed colors under the same "bright shell"
 * exception as the rest of this system).
 */
function BrightSkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-[#ececf1]", className)} />;
}

/** Matches organizer-resubmit-page.tsx's single-column form shape. */
export function OrganizerBrightFormSkeleton() {
  return (
    <main className="flex-1 px-lg pt-xl pb-28 md:pt-section" aria-busy="true">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-lg">
        <div className="flex flex-col gap-xs">
          <BrightSkeletonBlock className="h-9 w-2/3" />
          <BrightSkeletonBlock className="h-4 w-full max-w-[420px]" />
        </div>
        <BrightSkeletonBlock className="h-12 w-full" />
        <div className="grid gap-md sm:grid-cols-2">
          <BrightSkeletonBlock className="h-12 w-full" />
          <BrightSkeletonBlock className="h-12 w-full" />
        </div>
        <BrightSkeletonBlock className="h-12 w-full max-w-[200px]" />
        <BrightSkeletonBlock className="h-32 w-full" />
        <BrightSkeletonBlock className="h-12 w-32" />
      </div>
    </main>
  );
}

/** Matches organizer-apply-page.tsx's two-column (form + applications rail) shape. */
export function OrganizerBrightApplySkeleton() {
  return (
    <main className="flex-1 px-lg pt-xl pb-28 md:pt-section" aria-busy="true">
      <div className="mx-auto grid w-full max-w-[1100px] gap-xxl lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-lg">
          <div className="flex flex-col gap-xs">
            <BrightSkeletonBlock className="h-9 w-2/3" />
            <BrightSkeletonBlock className="h-4 w-full max-w-[420px]" />
          </div>
          <BrightSkeletonBlock className="h-12 w-full" />
          <div className="grid gap-md sm:grid-cols-2">
            <BrightSkeletonBlock className="h-12 w-full" />
            <BrightSkeletonBlock className="h-12 w-full" />
          </div>
          <BrightSkeletonBlock className="h-32 w-full" />
        </div>
        <BrightSkeletonBlock className="h-48 w-full" />
      </div>
    </main>
  );
}

/** Matches organizer-onboarding-page.tsx's stepper + step-content shape. */
export function OrganizerBrightWizardSkeleton() {
  return (
    <main className="flex-1 px-lg pt-xl pb-28 md:pt-section" aria-busy="true">
      <div className="mx-auto grid w-full max-w-[1160px] gap-xl lg:grid-cols-[220px_minmax(0,690px)] lg:justify-center lg:gap-[180px]">
        <div className="flex gap-1 lg:flex-col lg:gap-2">
          <BrightSkeletonBlock className="h-8 flex-1 lg:h-10 lg:flex-none" />
          <BrightSkeletonBlock className="h-8 flex-1 lg:h-10 lg:flex-none" />
          <BrightSkeletonBlock className="h-8 flex-1 lg:h-10 lg:flex-none" />
        </div>
        <div className="flex flex-col gap-lg lg:col-start-2 lg:row-start-1">
          <BrightSkeletonBlock className="h-9 w-2/3" />
          <BrightSkeletonBlock className="h-12 w-full" />
          <BrightSkeletonBlock className="h-12 w-full" />
          <BrightSkeletonBlock className="h-12 w-40" />
        </div>
      </div>
    </main>
  );
}
