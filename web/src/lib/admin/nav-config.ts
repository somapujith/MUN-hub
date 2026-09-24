import {
  LayoutDashboardIcon,
  LineChartIcon,
  ClipboardCheckIcon,
  ShieldCheckIcon,
  RocketIcon,
  CalendarDaysIcon,
  TicketIcon,
  BadgeIndianRupeeIcon,
  Building2Icon,
  LifeBuoyIcon,
  UsersIcon,
  ScrollTextIcon,
  LockKeyholeIcon,
} from "lucide-react";
import type { AdminOverviewStats } from "@/types/admin-audit";

interface AdminNavItem {
  href: string;
  label: string;
  exact: boolean;
  icon: typeof LayoutDashboardIcon;
  /** Key into AdminOverviewStats whose count renders as a badge next to this item. */
  statKey?: keyof AdminOverviewStats;
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin", label: "Overview", exact: true, icon: LayoutDashboardIcon },
  { href: "/admin/reporting", label: "Analytics", exact: false, icon: LineChartIcon },
  { href: "/admin/review", label: "Applications", exact: false, icon: ClipboardCheckIcon, statKey: "pendingApplications" },
  { href: "/admin/verification", label: "Verification", exact: false, icon: ShieldCheckIcon, statKey: "pendingModuleReviews" },
  { href: "/admin/go-live-queue", label: "Go-live queue", exact: false, icon: RocketIcon, statKey: "goLiveQueue" },
  { href: "/admin/muns", label: "Conferences", exact: false, icon: CalendarDaysIcon },
  { href: "/admin/registrations", label: "Registrations", exact: false, icon: TicketIcon },
  { href: "/admin/payments", label: "Payments", exact: false, icon: BadgeIndianRupeeIcon, statKey: "paymentExceptions" },
  { href: "/admin/organizers", label: "Organizers", exact: false, icon: Building2Icon },
  { href: "/admin/support", label: "Support", exact: false, icon: LifeBuoyIcon, statKey: "openSupportTickets" },
  { href: "/admin/staff", label: "Staff", exact: false, icon: UsersIcon },
  { href: "/admin/audit", label: "Audit Log", exact: false, icon: ScrollTextIcon },
  { href: "/admin/security", label: "Security", exact: false, icon: LockKeyholeIcon },
];

export const ADMIN_REVIEW_ROLES = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"] as const;
