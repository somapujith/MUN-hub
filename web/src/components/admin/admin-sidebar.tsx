import { Link } from "react-router";
import { cn } from "cn";
import { AdminNav } from "@/components/admin/admin-nav";

interface AdminSidebarProps {
  onNavigate?: () => void;
  className?: string;
}

export function AdminSidebar({ onNavigate, className }: AdminSidebarProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-sidebar", className)}>
      <div className="border-b border-sidebar-border p-sm">
        <Link
          to="/admin"
          className="flex w-fit items-center gap-xs rounded-sm px-xs py-xxs font-display text-title-sm tracking-[-0.006em] text-ink outline-none transition-colors duration-150 ease-out hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
        >
          MUN Hub
          <span className="rounded-xs bg-surface-strong px-xxs py-px text-[11px] font-medium tracking-[0.16px] text-body uppercase dark:bg-muted dark:text-muted-foreground">
            Admin
          </span>
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-sm pr-sm pl-xs">
        <AdminNav onNavigate={onNavigate} />
      </div>
      <div className="border-t border-sidebar-border p-sm">
        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-xs rounded-sm px-xs py-[7px] text-body-md text-muted-foreground outline-none transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-ink focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
        >
          Back to marketplace
        </Link>
      </div>
    </div>
  );
}
