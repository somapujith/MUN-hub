import { Suspense } from "react";
import { Outlet } from "react-router";
import { RequireAuth } from "@/guards/require-auth";
import { RequireRole } from "@/guards/require-role";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { RouteLoadingSkeleton } from "@/components/layout/route-loading-skeleton";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { ADMIN_REVIEW_ROLES } from "@/lib/admin/nav-config";

// Signed-out visitors are sent to /admin/login (RequireAuth); signed-in
// non-staff get the 403 screen (RequireRole).
export function AdminLayout() {
  return (
    <RequireAuth>
      <RequireRole roles={ADMIN_REVIEW_ROLES}>
        <div className="flex min-h-full flex-col lg:h-dvh lg:overflow-hidden">
          <SiteHeader />
          {/* Below lg, the page scrolls as one normal document (sidebar lives in
              the mobile drawer instead). At lg+, the outer div above is hard-capped
              to the viewport height and clips overflow, so this row only ever gets
              the space left after the 4.5rem header — `min-h-0` is required here
              because a flex item's default `min-height: auto` would otherwise let
              its content (the scrolling column) push the row, and so the whole
              document, taller than the viewport regardless of the `overflow-hidden`
              above (confirmed: without it the sidebar scrolled away with the page
              instead of staying put). Only the content column below scrolls. */}
          <div className="flex min-h-0 min-w-0 flex-1 lg:overflow-hidden">
            <aside className="hidden w-[16rem] shrink-0 border-r border-sidebar-border bg-background lg:block lg:h-full">
              <AdminSidebar />
            </aside>
            <div className="flex min-w-0 flex-1 flex-col lg:h-full lg:overflow-y-auto lg:[scrollbar-gutter:stable]">
              <div className="sticky top-[4.5rem] z-30 flex items-center gap-sm border-b border-border bg-background/92 px-sm py-xs backdrop-blur-xl lg:hidden">
                <AdminMobileNav />
                <p className="text-body-md font-medium text-ink">Admin</p>
              </div>
              <Suspense fallback={<RouteLoadingSkeleton />}>
                <Outlet />
              </Suspense>
              <SiteFooter />
            </div>
          </div>
        </div>
      </RequireRole>
    </RequireAuth>
  );
}
