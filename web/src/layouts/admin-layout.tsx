import { Link, Outlet, useLocation } from "react-router";
import { cn } from "cn";
import { RequireRole } from "@/guards/require-role";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { ADMIN_NAV_ITEMS, ADMIN_REVIEW_ROLES } from "@/lib/admin/nav-config";

function isNavActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminLayout() {
  const { pathname } = useLocation();

  return (
    <RequireRole roles={ADMIN_REVIEW_ROLES}>
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <nav aria-label="Admin" className="border-b border-border bg-surface-soft/60">
          <div className="content-container flex items-center gap-md overflow-x-auto py-sm">
            {ADMIN_NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                aria-current={isNavActive(pathname, item.href, item.exact) ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-sm px-2 py-1 text-body-md whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
                  isNavActive(pathname, item.href, item.exact)
                    ? "font-medium text-ink"
                    : "text-muted-foreground hover:text-ink",
                )}
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
  );
}
