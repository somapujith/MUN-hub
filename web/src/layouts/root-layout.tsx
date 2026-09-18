import { useEffect } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router";
import { Helmet } from "react-helmet-async";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { canonicalUrlFor } from "@/lib/host-routing";

export function RootLayout() {
  const location = useLocation();

  // Organizer pages live on publish.munhub.in. Every host serves the same SPA,
  // so without this a visit to munhub.in/organizer/... would render the
  // organizer workspace on the marketplace host. Checked on every navigation
  // (not just first load) because in-app <Link>s can also lead there.
  // No-op in local dev, where every zone shares one origin.
  const canonical = canonicalUrlFor(location.pathname, location.search);

  useEffect(() => {
    if (canonical) window.location.replace(canonical);
  }, [canonical]);

  // Render nothing while leaving, so the organizer page never flashes on the
  // wrong host.
  if (canonical) return null;

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <Helmet
        defaultTitle="MUN Hub — Find and register for Model UN conferences"
        titleTemplate="%s | MUN Hub"
      />
      <TooltipProvider>
        <div className="flex min-h-dvh flex-col">
          <Outlet />
        </div>
        {/* No global scroll reset existed before this — a client-side
            navigation left the next page at the previous page's scroll
            offset (confirmed severely broken on the registration funnel:
            landing on the Pay page scrolled to the site footer, with the
            payment form and button off-screen). This is the router-level
            fix recommended alongside the per-page `useScrollToTop`
            workarounds already applied to the student-facing pages that
            most needed it before this landed — those are now a harmless,
            redundant belt-and-suspenders on top of this for forward
            navigation, while this alone additionally covers organizer/admin
            navigation and restores scroll position on browser back/forward.
            components/content/info-page.tsx's own hash-aware scroll (for
            About/Contact/Legal's in-page anchors) and mun-detail-page.tsx's
            hash guard are unaffected — neither is a hash-restoration
            concern this component addresses. */}
        <ScrollRestoration />
        {/* Bottom-right, stacked above the floating support button: top-center
            covered the breadcrumb and status badge in the workspace header. */}
        <Toaster
          richColors
          closeButton
          position="bottom-right"
          offset={{ bottom: 88, right: 24 }}
          mobileOffset={{ bottom: 84, right: 16, left: 16 }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}

/** Public route group — chrome is per-page (matches Next SiteHeader pattern). */
export function PublicLayout() {
  return <Outlet />;
}
