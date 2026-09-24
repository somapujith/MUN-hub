import { Suspense, useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { RequireAuth } from "@/guards/require-auth";
import { RegistrationPageSkeleton } from "@/components/registration/registration-page-skeleton";

/**
 * Registration funnel — UX auth gate; server is authoritative.
 *
 * Also resets scroll to the top on every step (Option/Details/Review → Pay →
 * Confirmation are each a distinct route under here). The router has no
 * global `<ScrollRestoration />` (see components/content/info-page.tsx's own
 * copy of this same fix for the About/Contact/Legal pages), so a client-side
 * `navigate()` from a scrolled-down step otherwise leaves the browser at that
 * same scroll offset on the next page. Measured concretely: landing on
 * RegisterPayPage after the auto-scrolled Review step left the viewport at
 * scrollY ~940 on a page whose own content doesn't reach that far — the
 * visible viewport showed the site footer instead of the payment form, with
 * "Complete your payment" and the Pay button scrolled out of view above it.
 */
export function RegisterLayout() {
  useScrollToTopOnStepChange();
  return (
    <RequireAuth>
      <Suspense fallback={<RegistrationPageSkeleton />}>
        <Outlet />
      </Suspense>
    </RequireAuth>
  );
}

function useScrollToTopOnStepChange() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
}
