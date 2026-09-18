import * as React from "react";
import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router";
import { cn } from "cn";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

/**
 * Shared frame for the static About / Contact / Legal pages.
 *
 * The router has no global <ScrollRestoration />, so a footer link would
 * otherwise open these pages at whatever depth the previous page was scrolled
 * to. This frame scrolls to the URL hash target when there is one (footer
 * deep links, the legal table of contents), and to the top otherwise.
 */
export function InfoPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  useScrollToHashOrTop();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>{`${title} | MUN Hub`}</title>
        <meta name="description" content={description} />
      </Helmet>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

function useScrollToHashOrTop() {
  const { pathname, hash } = useLocation();

  React.useLayoutEffect(() => {
    if (hash) {
      let target: HTMLElement | null = null;
      try {
        target = document.getElementById(decodeURIComponent(hash.slice(1)));
      } catch {
        // Malformed escape in a hand-typed URL — fall through to the top.
      }
      if (target) {
        const section = target;
        section.scrollIntoView();

        // On a cold load the web font arrives after this first scroll and
        // reflows the text above the target, leaving the view hundreds of
        // pixels past it. Scroll again once fonts have settled — unless the
        // reader has started scrolling by then.
        let settled = false;
        const stop = () => {
          settled = true;
        };
        const events = ["wheel", "touchstart", "keydown"] as const;
        events.forEach((name) => window.addEventListener(name, stop, { passive: true, once: true }));
        void document.fonts?.ready.then(() => {
          requestAnimationFrame(() => {
            if (!settled) section.scrollIntoView();
          });
        });
        return () => {
          stop();
          events.forEach((name) => window.removeEventListener(name, stop));
        };
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
}

export function PageHero({
  eyebrow,
  title,
  lede,
  children,
  image,
  imageAlt,
}: {
  eyebrow: string;
  title: string;
  lede?: React.ReactNode;
  children?: React.ReactNode;
  /** Optional full-bleed background photo. Switches the hero to light text over a dark scrim instead of the plain text-on-canvas layout. */
  image?: string;
  imageAlt?: string;
}) {
  if (image) {
    return (
      <div className="relative overflow-hidden bg-ink">
        <img
          src={image}
          alt={imageAlt ?? ""}
          aria-hidden={imageAlt ? undefined : true}
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />
        <div className="content-container relative flex min-h-[360px] flex-col justify-end gap-sm pt-xxl pb-xl md:min-h-[440px] md:pb-xxl">
          <p className="text-caption uppercase tracking-[0.16px] text-white/70">
            {eyebrow}
          </p>
          <h1 className="max-w-[22ch] font-display text-display-md font-normal tracking-[-0.011em] text-balance text-white sm:text-display-lg">
            {title}
          </h1>
          {lede ? (
            <p className="max-w-[60ch] text-title-md text-pretty text-white/85">
              {lede}
            </p>
          ) : null}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-border">
      <div className="content-container flex flex-col gap-sm pt-xxl pb-xl md:pt-section md:pb-xxl">
        <p className="text-caption uppercase tracking-[0.16px] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="max-w-[22ch] font-display text-display-md font-normal tracking-[-0.011em] text-balance text-ink sm:text-display-lg">
          {title}
        </h1>
        {lede ? (
          <p className="max-w-[60ch] text-title-md text-pretty text-body dark:text-muted-foreground">
            {lede}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** A titled band inside an info page. `id` makes it a deep-link target. */
export function InfoSection({
  id,
  eyebrow,
  title,
  intro,
  className,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  intro?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24", className)}>
      <div className="flex max-w-3xl flex-col gap-sm">
        {eyebrow ? (
          <p className="text-caption uppercase tracking-[0.16px] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="font-display text-title-lg font-normal text-balance text-ink sm:text-display-md">
          {title}
        </h2>
        {intro ? (
          <p className="max-w-[62ch] text-base leading-7 text-pretty text-body dark:text-muted-foreground">
            {intro}
          </p>
        ) : null}
      </div>
      {children ? <div className="mt-lg">{children}</div> : null}
    </section>
  );
}

/**
 * Long-form reading column. Styles plain `p` / `ul` / `ol` / `a` / `strong` /
 * `h3` children so page content can stay as ordinary JSX.
 */
export function Prose({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "max-w-[68ch] text-base leading-7 text-body dark:text-muted-foreground",
        "[&>*+*]:mt-md",
        // No `[&_h3]:text-ink` here: `cn` can't tell the custom `text-title-sm`
        // size token from a text color and would drop the size. The base
        // layer already colors every h3 with --ink.
        "[&_h3]:mt-lg [&_h3]:font-display [&_h3]:text-title-sm [&_h3]:font-medium [&>h3:first-child]:mt-0",
        "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-lg [&_ol]:pl-lg",
        "[&_li]:pl-xxs [&_li+li]:mt-xs [&_li::marker]:text-muted-foreground",
        "[&_strong]:font-medium [&_strong]:text-ink",
        "[&_a]:text-link [&_a]:underline [&_a]:decoration-link/40 [&_a]:underline-offset-4 [&_a:hover]:decoration-link",
        className,
      )}
      {...props}
    />
  );
}
