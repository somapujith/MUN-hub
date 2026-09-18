import { useEffect } from "react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { ArrowRightIcon, RefreshCwIcon } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { PageMeta } from "@/components/seo/page-meta";
import { Button } from "@/components/ui/button";
import { useScrollToTop } from "@/hooks/use-scroll-to-top";

/**
 * `errorElement` for the route tree (wired in routes.tsx) — what a visitor
 * sees instead of React Router's own unstyled default error screen whenever a
 * page throws during render, or a loader/action throws. Sits one level below
 * `RootLayout` (a pathless wrapper route owns this, not `RootLayout` itself)
 * so ThemeProvider/Toaster/ScrollRestoration stay mounted around it — only the
 * broken page's own subtree is replaced.
 *
 * Distinct from `NotFoundPage`: that's the catch-all for a path nothing
 * matched. This is for a path that matched but blew up while rendering it.
 */

const HELPFUL_LINKS = [
  { to: "/muns", label: "Browse conferences", description: "Every reviewed MUN, with filters for city, dates and fees." },
  { to: "/dashboard", label: "My registrations", description: "Passes you've bought and registrations in progress." },
  { to: "/contact", label: "Contact support", description: "Tell us what happened and we'll help." },
] as const;

/** Best-effort human message for a routing error, without ever leaking internals to a real visitor. */
function describeError(error: unknown): { title: string; detail: string } {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return { title: "We couldn't find that page", detail: "The link may be mistyped, or the page is no longer available." };
    }
    if (error.status === 401 || error.status === 403) {
      return { title: "You don't have access to that page", detail: "Sign in with an account that has access, or head back home." };
    }
    return {
      title: `Something went wrong (${error.status})`,
      detail: error.statusText || "The server ran into a problem loading this page.",
    };
  }
  return {
    title: "Something went wrong",
    detail: "This page hit an unexpected error. It's on us — reloading usually fixes it.",
  };
}

export function ErrorPage() {
  useScrollToTop();
  const error = useRouteError();
  const { title, detail } = describeError(error);

  // Effect, not a bare call in render: keeps this from re-logging on every
  // render pass (React Strict Mode's double-render included) while still
  // always firing once — otherwise the boundary would silently swallow the
  // error with nothing in the console.
  useEffect(() => {
    console.error("Route error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <PageMeta
        title="Something went wrong | MUN Hub"
        description="This page hit an unexpected error."
        path="/error"
        noindex
        omitCanonical
      />

      <SiteHeader />

      <main className="flex-1">
        <div className="content-container flex flex-col gap-xl py-xxl md:py-section">
          <div className="flex max-w-2xl flex-col items-start gap-md">
            <p className="text-caption uppercase tracking-[0.16px] text-muted-foreground">
              {isRouteErrorResponse(error) ? `Error ${error.status}` : "Unexpected error"}
            </p>
            <h1 className="font-display text-display-md font-normal tracking-[-0.011em] text-balance text-ink md:text-display-lg">
              {title}
            </h1>
            <p className="text-title-md font-normal text-body dark:text-muted-foreground">{detail}</p>

            {import.meta.env.DEV && error instanceof Error && (
              <pre className="mt-xs max-w-full overflow-x-auto rounded-md border border-border bg-surface-soft p-md text-[12px] text-destructive-text">
                {error.stack ?? error.message}
              </pre>
            )}

            <div className="mt-xs flex flex-wrap gap-sm">
              <Button onClick={() => window.location.reload()}>
                <RefreshCwIcon aria-hidden />
                Reload page
              </Button>
              <Button variant="outline" render={<Link to="/" />}>
                Back to home
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
