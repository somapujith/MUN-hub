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
        <div className="flex min-h-full flex-1 flex-col">
          <SiteHeader />
          {/* Below lg, the page scrolls as one normal document (sidebar lives in
              the mobile drawer instead). At lg+, this row is pinned to the
              viewport under the 4.5rem header and only the content column
              scrolls, so the sidebar stays fully visible alongside it. */}
          <div className="flex min-w-0 flex-1 lg:h-[calc(100dvh-4.5rem)] lg:overflow-hidden">
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
