import type { ReactNode } from "react";

/**
 * Full-screen two-panel auth layout: a photographic panel on the left carrying
 * the brand and a one-line pitch, the form centered on a quiet panel on the
 * right. The left panel collapses away below `lg` — on a phone the form is the
 * whole job, and a half-screen photo would push it below the fold.
 */
interface AuthSplitLayoutProps {
  /**
   * Served from web/public. Layered over a gradient, so the panel still reads
   * as intentional before the image file exists or if it fails to load.
   */
  imageSrc: string;
  headline: string;
  subtext: string;
  /** Rendered pinned to the bottom of the right panel. */
  footer?: ReactNode;
  children: ReactNode;
}

export function AuthSplitLayout({ imageSrc, headline, subtext, footer, children }: AuthSplitLayoutProps) {
  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-2">
      <aside
        className="relative hidden overflow-hidden bg-cover bg-center lg:flex lg:flex-col lg:justify-between"
        style={{
          backgroundImage: `url("${imageSrc}"), linear-gradient(160deg, #0b1026 0%, #2a1a6e 45%, #5b2bd1 75%, #aa2d00 100%)`,
        }}
      >
        {/* Legibility scrim: darkens the top behind the wordmark and the bottom
            behind the pitch, whatever the photo underneath looks like. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.45)_0%,rgba(0,0,0,0)_28%,rgba(0,0,0,0)_55%,rgba(0,0,0,0.75)_100%)]"
        />

        <div className="relative flex justify-center px-xl pt-section">
          <span className="flex items-center gap-sm font-display text-display-md font-medium tracking-[-0.02em] text-white">
            <span aria-hidden className="size-3 rounded-full bg-signature-coral" />
            MUN Hub
          </span>
        </div>

        <div className="relative flex flex-col items-center gap-sm px-xl pb-section text-center">
          <h2 className="max-w-[20ch] font-display text-display-md text-balance text-white">{headline}</h2>
          <p className="max-w-[48ch] text-body-md text-pretty text-white/85">{subtext}</p>
        </div>
      </aside>

      <main className="flex min-h-dvh flex-col bg-[linear-gradient(135deg,var(--background)_0%,var(--surface-soft)_100%)]">
        <div className="flex flex-1 items-center justify-center px-lg py-xxl">{children}</div>
        {footer ? (
          <footer className="mx-auto w-full max-w-[420px] border-t border-border px-lg py-lg text-center text-body-md text-muted-foreground">
            {footer}
          </footer>
        ) : null}
      </main>
    </div>
  );
}
