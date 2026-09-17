import { Link } from "react-router";
import { ArrowRightIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { PageMeta } from "@/components/seo/page-meta";
import { Button } from "@/components/ui/button";

/**
 * 404 — also what a MUN page renders for an unknown or unpublished slug.
 * Kept out of search indexes (`noindex`, no canonical) and pointed at the
 * places a lost visitor most likely wanted.
 */

const HELPFUL_LINKS = [
  { to: "/muns", label: "Browse conferences", description: "Every reviewed MUN, with filters for city, dates and fees." },
  { to: "/dashboard", label: "My registrations", description: "Passes you've bought and registrations in progress." },
  { to: "/organizer/login", label: "Organizer workspace", description: "Run your conference, registrations and go-live checklist." },
  { to: "/contact", label: "Contact support", description: "Tell us what you were looking for and we'll help." },
] as const;

export function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <PageMeta
        title="Page not found | MUN Hub"
        description="The page you were looking for doesn't exist or is no longer available."
        path="/404"
        noindex
        omitCanonical
      />

      <SiteHeader />

      <main className="flex-1">
        <div className="content-container flex flex-col gap-xl py-xxl md:py-section">
          <div className="flex max-w-2xl flex-col items-start gap-md">
            <p className="text-caption uppercase tracking-[0.16px] text-muted-foreground">Error 404</p>
            <h1 className="font-display text-display-md font-normal tracking-[-0.011em] text-balance text-ink md:text-display-lg">
              We couldn&apos;t find that page
            </h1>
            <p className="text-title-md font-normal text-body dark:text-muted-foreground">
              The link may be mistyped, or the conference may not be published yet. Conference pages
              appear here once their organizers clear review.
            </p>
            <div className="mt-xs flex flex-wrap gap-sm">
              <Button render={<Link to="/" />}>Back to home</Button>
              <Button variant="outline" render={<Link to="/muns" />}>
                Browse conferences
              </Button>
            </div>
          </div>

          <nav aria-label="Helpful links" className="max-w-3xl border-t border-border pt-lg">
            <ul className="grid list-none grid-cols-1 gap-sm p-0 sm:grid-cols-2">
              {HELPFUL_LINKS.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="group flex h-full flex-col gap-xxs rounded-md border border-border bg-card p-md transition-[border-color,background-color] duration-150 outline-none hover:border-border-strong hover:bg-surface-soft focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 dark:hover:bg-accent"
                  >
                    <span className="flex items-center justify-between gap-sm text-label-md text-ink">
                      {link.label}
                      <ArrowRightIcon
                        aria-hidden
                        strokeWidth={1.75}
                        className="size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-px"
                      />
                    </span>
                    <span className="text-body-md text-muted-foreground">{link.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
