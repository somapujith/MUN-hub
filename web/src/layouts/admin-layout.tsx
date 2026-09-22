import { useEffect, useRef } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { RequireAuth } from "@/guards/require-auth";
import { RequireRole } from "@/guards/require-role";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { ADMIN_NAV_ITEMS, ADMIN_REVIEW_ROLES } from "@/lib/admin/nav-config";
import { attachScrollFade } from "@/lib/scroll-fade";

function isNavActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Scrolls the active tab fully into view within the strip, if it isn't
// already. getBoundingClientRect, not offsetLeft: offsetLeft is relative to
// the nearest *positioned* ancestor, which may not be this scroll container.
function revealActiveTab(el: HTMLDivElement) {
  const active = el.querySelector<HTMLElement>('[aria-current="page"]');
  if (!active) return;
  const elRect = el.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  const left = activeRect.left - elRect.left + el.scrollLeft;
  const right = activeRect.right - elRect.left + el.scrollLeft;
  if (left < el.scrollLeft) el.scrollLeft = left - 16;
  else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + 16;
}

export function AdminLayout() {
  const { pathname } = useLocation();
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // The strip has 13 items and reliably overflows at common laptop widths
  // (confirmed ~100px of hidden content at 1440px), clipping "Audit Log" and
  // "Security" with no visible scrollbar and no way to reach them with an
  // ordinary vertical mouse wheel. Two fixes, both needed. Both are wired
  // through a ref callback rather than plain `useRef` + `useEffect(..., [])`:
  // RequireAuth/RequireRole render this div only after an async session
  // check, so a mount-only effect can run before the div exists and never
  // fire again once it does.
  const setScrollerRef = (el: HTMLDivElement | null) => {
    scrollerRef.current = el;
    if (!el) return;
    revealActiveTab(el);
    // Fade hint at whichever edge still has hidden tabs (e.g. "Audit Log"/
    // "Security" clipped off the right at common laptop widths — see above).
    const detachFade = attachScrollFade(el, "x");
    // Redirect vertical wheel input to horizontal scroll, same as GitHub's
    // and Notion's horizontally-scrolling tab strips — a trackpad or a
    // click-drag on the (hidden-until-hover) scrollbar already works, but a
    // plain mouse wheel does nothing by default on an x-only overflow.
    // A native listener, not React's onWheel, is required to preventDefault
    // (React attaches wheel handlers as passive). Returned as this ref
    // callback's cleanup (React 19) so StrictMode's mount/unmount/mount
    // dev-mode replay can't double-attach it.
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      el.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // The strip's tab labels render in Inter, loaded from Google Fonts with
    // `display=swap` (index.html) — a cold load first paints the fallback
    // system font, then swaps to Inter once it arrives, which reflows every
    // tab's width. `revealActiveTab` above ran against the pre-swap widths,
    // so at any width where the strip actually needs to scroll (below where
    // all 13 tabs fit, ~1280px+) the active tab landed only partially
    // revealed — confirmed: "Audit Log" clipped ~49px into the hidden area
    // at 320-1024px, with nothing to ever recompute it afterward. Same fix
    // pattern already used in info-page.tsx's hash-scroll for the same root
    // cause: re-run once the font has settled, unless the visitor already
    // started scrolling the strip themselves by then.
    let settled = false;
    const stopSettle = () => {
      settled = true;
    };
    const settleEvents = ["wheel", "touchstart", "keydown"] as const;
    settleEvents.forEach((name) => el.addEventListener(name, stopSettle, { passive: true, once: true }));
    void document.fonts?.ready.then(() => {
      requestAnimationFrame(() => {
        if (!settled) revealActiveTab(el);
      });
    });

    return () => {
      el.removeEventListener("wheel", onWheel);
      settleEvents.forEach((name) => el.removeEventListener(name, stopSettle));
      detachFade();
    };
  };

  // Once mounted, later client-side navigation (e.g. clicking "Audit Log"
  // then "Security") still needs to re-reveal the newly active tab.
  useEffect(() => {
    if (scrollerRef.current) revealActiveTab(scrollerRef.current);
  }, [pathname]);

  // Signed-out visitors are sent to /admin/login (RequireAuth); signed-in
  // non-staff get the 403 screen (RequireRole).
  return (
    <RequireAuth>
      <RequireRole roles={ADMIN_REVIEW_ROLES}>
        <div className="flex min-h-full flex-1 flex-col">
          <SiteHeader />
          <nav aria-label="Admin" className="sticky top-[4.5rem] z-30 border-b border-border bg-background/92 backdrop-blur-xl">
            <div ref={setScrollerRef} className="content-container flex items-center gap-md overflow-x-auto py-sm">
              {ADMIN_NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  aria-current={isNavActive(pathname, item.href, item.exact) ? "page" : undefined}
                  // Plain concatenation, not cn(): cn() treats the custom
                  // text-body-md size token and a text colour as one conflict
                  // group and silently drops the size.
                  className={`shrink-0 rounded-sm px-2 py-1 text-body-md whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none ${
                    isNavActive(pathname, item.href, item.exact)
                      ? "bg-primary font-medium text-primary-foreground!"
                      : "text-muted-foreground hover:bg-surface-soft hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
          <Outlet />
          <SiteFooter />
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
