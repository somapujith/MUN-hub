import type { LucideIcon } from "lucide-react";
import {
  AwardIcon,
  BadgeCheckIcon,
  BedDoubleIcon,
  CalendarCheck2Icon,
  ChartNoAxesColumnIcon,
  FileTextIcon,
  FolderOpenIcon,
  LayersIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MegaphoneIcon,
  RocketIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  TagIcon,
  UserCogIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";

export interface MunNavSection {
  segment: string;
  label: string;
  icon: LucideIcon;
  group: MunNavGroup;
  title?: string;
}

export type MunNavGroup = "Conference" | "Delegates" | "Operations" | "Admin";

export const MUN_NAV_GROUP_ORDER: readonly MunNavGroup[] = [
  "Conference",
  "Delegates",
  "Operations",
  "Admin",
];

export const MUN_NAV_SECTIONS: readonly MunNavSection[] = [
  { segment: "quick-setup", label: "Quick Setup", icon: RocketIcon, group: "Conference" },
  { segment: "setup", label: "MUN Setup", icon: SlidersHorizontalIcon, group: "Conference" },
  { segment: "committees", label: "Committees & Portfolios", icon: LayersIcon, group: "Conference", title: "Committees & portfolios" },
  { segment: "executive-board", label: "Executive Board", icon: UsersRoundIcon, group: "Conference" },
  { segment: "products", label: "Registration Products", icon: TagIcon, group: "Delegates" },
  { segment: "form", label: "Registration Form", icon: ListChecksIcon, group: "Delegates" },
  { segment: "accommodation", label: "Accommodation", icon: BedDoubleIcon, group: "Delegates" },
  { segment: "registrations", label: "Registrations", icon: UsersIcon, group: "Delegates" },
  { segment: "communications", label: "Communications", icon: MegaphoneIcon, group: "Operations" },
  { segment: "documents", label: "Documents & Media", icon: FolderOpenIcon, group: "Operations" },
  { segment: "conference-day", label: "Conference Day", icon: CalendarCheck2Icon, group: "Operations" },
  { segment: "results", label: "Results & Awards", icon: AwardIcon, group: "Operations" },
  { segment: "certificates", label: "Certificates", icon: BadgeCheckIcon, group: "Operations" },
  { segment: "analytics", label: "Analytics", icon: ChartNoAxesColumnIcon, group: "Admin" },
  { segment: "team", label: "Team & Permissions", icon: UserCogIcon, group: "Admin" },
  { segment: "settings", label: "Settings", icon: SettingsIcon, group: "Admin" },
];

export interface WorkspaceNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
}

export const WORKSPACE_NAV_ITEMS: readonly WorkspaceNavItem[] = [
  { href: "/organizer/dashboard", label: "Overview", icon: LayoutDashboardIcon, exact: true },
  { href: "/organizer/dashboard/muns", label: "My MUNs", icon: FileTextIcon, exact: false },
];

export function munSectionHref(munId: string, segment: string): string {
  return `/organizer/dashboard/${munId}/${segment}`;
}

export function getMunNavSection(segment: string): MunNavSection | undefined {
  return MUN_NAV_SECTIONS.find((section) => section.segment === segment);
}

/** Parse path under /organizer/dashboard for breadcrumb + switcher. */
export function parseOrganizerDashboardPath(pathname: string): {
  orgWideLeaf: string | null;
  munId: string | null;
  section: string | null;
} {
  const prefix = "/organizer/dashboard";
  if (!pathname.startsWith(prefix)) {
    return { orgWideLeaf: null, munId: null, section: null };
  }
  const rest = pathname.slice(prefix.length).replace(/^\//, "");
  if (!rest) return { orgWideLeaf: null, munId: null, section: null };
  const parts = rest.split("/");
  if (parts[0] === "muns") return { orgWideLeaf: "muns", munId: null, section: null };
  if (parts.length >= 2) return { orgWideLeaf: null, munId: parts[0], section: parts[1] };
  return { orgWideLeaf: null, munId: parts[0], section: null };
}
