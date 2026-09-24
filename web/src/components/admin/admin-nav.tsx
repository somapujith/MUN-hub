import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { getAdminOverviewStats } from "@/api/admin-audit";
import { queryKeys } from "@/api/query-keys";
import { Badge } from "@/components/ui/badge";
import { ADMIN_NAV_ITEMS } from "@/lib/admin/nav-config";
import type { AdminOverviewStats } from "@/types/admin-audit";

interface AdminNavProps {
  onNavigate?: () => void;
}

function isActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const ITEM_BASE = [
  "flex items-center gap-xs rounded-sm px-xs py-[7px]",
  "text-body-md outline-none",
  "transition-[background-color,color] duration-150 ease-out",
  "focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
];

const ITEM_IDLE =
  "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-surface-strong dark:active:bg-muted";

const ITEM_ACTIVE = [
  "relative bg-sidebar-accent font-medium text-sidebar-accent-foreground",
  "before:absolute before:inset-y-1 before:-left-xs before:w-[2px]",
  "before:rounded-pill before:bg-sidebar-primary before:content-['']",
].join(" ");

const ICON_BASE = "size-4 shrink-0 transition-colors duration-150 ease-out";

/** Caps the badge label the same way the header's unread-count badge does. */
function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function AdminNav({ onNavigate }: AdminNavProps) {
  const { pathname } = useLocation();
  // Same queryKey + queryFn as AdminOverviewPage (pages/admin/overview-page.tsx)
  // — a shared cache entry, not a duplicate fetch, and no explicit staleTime
  // here means it inherits the same default (query-client.ts) that page uses.
  const statsQuery = useQuery<AdminOverviewStats>({
    queryKey: queryKeys.adminOverview(),
    queryFn: getAdminOverviewStats,
  });
  const stats = statsQuery.data;

  return (
    <nav aria-label="Admin" className="flex flex-1 flex-col pl-xs">
      {/* justify-between spreads the items across whatever height the
          sidebar actually has (any viewport), instead of a fixed gap that
          only looks filled at one specific screen height. gap-px stays as
          the floor when content overflows a very short viewport. */}
      <ul className="flex h-full list-none flex-col justify-between gap-px">
        {ADMIN_NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href, item.exact);
          const Icon = item.icon;
          const count = item.statKey && stats ? stats[item.statKey] : undefined;
          return (
            <li key={item.href}>
              <Link
                to={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(ITEM_BASE, active ? ITEM_ACTIVE : ITEM_IDLE)}
              >
                <Icon
                  aria-hidden
                  strokeWidth={1.75}
                  className={cn(ICON_BASE, active ? "text-sidebar-primary" : "text-muted-foreground")}
                />
                <span className="flex-1">{item.label}</span>
                {count !== undefined && count > 0 && (
                  <Badge variant="warning" className="shrink-0 tabular-nums">
                    {formatBadgeCount(count)}
                  </Badge>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
