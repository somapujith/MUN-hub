import { useLayoutEffect } from "react";

/**
 * Resets the browser's scroll position to the top on mount.
 *
 * The router has no global `<ScrollRestoration />` (react-router v7 data
 * mode ships one, but nothing renders it — see
 * components/content/info-page.tsx's own hash-aware copy of this same fix
 * for the About/Contact/Legal pages). Without it, a client-side
 * `navigate()`/`<Link>` from a page the delegate had scrolled down leaves
 * the next page rendered at that same scroll offset instead of at its top.
 *
 * Measured concretely on the registration funnel: landing on the payment
 * page after the (auto-scrolled) Review step left the viewport at scrollY
 * ~940 on a page whose own content doesn't reach that far — the visible
 * viewport showed the site footer instead of the payment form. The same
 * pattern reproduced landing on the group-manage and pass/receipt pages from
 * the (often tall) registration confirmation page.
 *
 * Use this on a page-level component that's a common `navigate()`/`<Link>`
 * target from a potentially-scrolled source outside its own layout. Where
 * several routes share one layout (e.g. the registration funnel's
 * `RegisterLayout`), resetting once per pathname change at the layout level
 * is preferable to repeating this on every child page.
 */
export function useScrollToTop(): void {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);
}
