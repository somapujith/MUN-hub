import type { LucideIcon } from "lucide-react";
import {
  AwardIcon,
  BadgeCheckIcon,
  BanknoteIcon,
  BedDoubleIcon,
  CalendarCheck2Icon,
  ChartNoAxesColumnIcon,
  FileTextIcon,
  FolderOpenIcon,
  LayersIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MegaphoneIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  TagIcon,
  UserCogIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";

/**
 * ORGANIZER WORKSPACE ROUTING — single source of truth.
 * ============================================================================
 *
 * PRD § 5 lists 17 nav items in one flat tree, but they are not all the same
 * kind of thing: two are organizer-wide (they span every conference you own)
 * and fifteen only mean anything relative to one specific MUN. The URL shape
 * encodes that split so a route can never be ambiguous about which tenant's
 * data it is reading:
 *
 *   /organizer/dashboard                     Overview      (organizer-wide)
 *   /organizer/dashboard/muns                My MUNs       (organizer-wide)
 *   /organizer/dashboard/[munId]/<section>   per-MUN sections
 *
 * WHY `[munId]` AND NOT `[slug]`
 * ------------------------------
 * Every frozen backend entry point this workspace calls is keyed by the mun's
 * uuid — `getMunOverview(munId)`, `getDelegateList(munId)`,
 * `listCommittees(munId)`, `createCommittee({ munId })`,
 * `updateMunDetails(munId)`, `submitMunForVerification(munId)`. A slug segment
 * would force a `muns.slug -> muns.id` lookup on literally every page and
 * every server action in the workspace before it could do anything. It would
 * also break the moment an organizer renames a DRAFT mun (its slug moves; the
 * id does not). Slugs stay where they belong: the public marketplace route,
 * `/mun/[slug]`.
 *
 * Exposing the uuid is not an authorization concern — `assertOwnsOrAdmin` in
 * `lib/actions/*` re-derives the actor from `getSession()` server-side and
 * checks `muns.organizerId` on every single call. The layout's ownership gate
 * (see `[munId]/layout.tsx`) is defence in depth and a 404 UX, not the
 * security boundary.
 *
 * WHY `[munId]` IS NESTED UNDER `/dashboard` AND NOT A SIBLING
 * -----------------------------------------------------------
 * `app/organizer/dashboard/layout.tsx` owns the auth gate + workspace chrome.
 * Nesting means every per-MUN section inherits both for free and no module
 * agent has to re-implement a role check. A sibling `/organizer/[munId]` would
 * have needed its own copy of both.
 *
 * SECTION SUB-TABS
 * ----------------
 * PRD § 5 nests seven children under "MUN Setup" (General, Branding, Dates &
 * Venue, Schedule, Rules, FAQs, Contact). Those are NOT sidebar entries — the
 * sidebar would become unusable at 24 items. They render as a horizontal tab
 * strip inside `/[munId]/setup` and own the search param `?tab=general`, which
 * is that module's business, not the shell's. The same applies to any future
 * sub-navigation: the sidebar stops at the 17 PRD items.
 *
 * PRD § 5 lists "Committees" and "Portfolios" as two entries. They are merged
 * into one sidebar item, "Committees & Portfolios" at `/[munId]/committees`,
 * because a portfolio has no meaning outside its committee — `createPortfolio`
 * takes a `committeeId`, never a `munId` — so a standalone Portfolios page
 * would have to begin by asking "which committee?", which is the committee
 * list you just navigated away from. Portfolios render as an expandable child
 * list per committee row.
 *
 * ADDING A SECTION
 * ----------------
 * Add an entry to `MUN_NAV_SECTIONS` below and create
 * `app/organizer/dashboard/[munId]/<segment>/page.tsx`. The sidebar, the
 * mobile drawer and the breadcrumb all read from this array — none of them
 * need touching. There is intentionally no route-level `<segment>` catch-all:
 * an unknown section should 404, not render an empty shell.
 */

/** A per-MUN section: the URL is `/organizer/dashboard/[munId]/{segment}`. */
export interface MunNavSection {
  /** URL segment under `[munId]`. Must match a real directory in `[munId]/`. */
  segment: string;
  /** Sidebar label. PRD § 5 wording, verbatim where it fits. */
  label: string;
  icon: LucideIcon;
  /** Sidebar group heading this item sits under. */
  group: MunNavGroup;
  /** Page-level `<h1>` and breadcrumb leaf, when they differ from `label`. */
  title?: string;
}

export type MunNavGroup = "Conference" | "Delegates" | "Operations" | "Admin";

/** Order matters — the sidebar renders groups in this order. */
export const MUN_NAV_GROUP_ORDER: readonly MunNavGroup[] = [
  "Conference",
  "Delegates",
  "Operations",
  "Admin",
];

/**
 * The per-MUN sections, in PRD § 5 order within their groups. Grouping is a
 * readability affordance only; it does not affect routing.
 *
 * This is 16 entries, not the 15 PRD § 5 lists: Accommodation is not a PRD § 5
 * nav item, but `accommodation_options` / `accommodation_option_fields` are
 * real tables with a full CRUD surface in `lib/actions/accommodation.ts` and no
 * other section can configure them. The two "17 nav items" references above
 * describe the PRD's flat tree, not this array — don't reconcile them by
 * deleting this entry.
 */
export const MUN_NAV_SECTIONS: readonly MunNavSection[] = [
  {
    segment: "setup",
    label: "MUN Setup",
    icon: SlidersHorizontalIcon,
    group: "Conference",
  },
  {
    segment: "committees",
    label: "Committees & Portfolios",
    icon: LayersIcon,
    group: "Conference",
    title: "Committees & portfolios",
  },
  {
    segment: "executive-board",
    label: "Executive Board",
    icon: UsersRoundIcon,
    group: "Conference",
  },
  {
    segment: "products",
    label: "Registration Products",
    icon: TagIcon,
    group: "Delegates",
  },
  {
    segment: "form",
    label: "Registration Form",
    icon: ListChecksIcon,
    group: "Delegates",
  },
  /*
   * Sits directly after the two "what a delegate buys" sections because that
   * is what it is: a paid add-on priced into the same order as the pass
   * (`registrations.accommodationOptionId` hangs off the same registration row,
   * and one webhook confirms both). Grouping it under Operations alongside
   * Documents or Conference Day would imply it is logistics an organizer
   * arranges after the fact, when it is actually inventory they sell up front
   * and must configure BEFORE registration opens.
   */
  {
    segment: "accommodation",
    label: "Accommodation",
    icon: BedDoubleIcon,
    group: "Delegates",
  },
  {
    segment: "registrations",
    label: "Registrations",
    icon: UsersIcon,
    group: "Delegates",
  },
  {
    segment: "finance",
    label: "Payments & Finance",
    icon: BanknoteIcon,
    group: "Delegates",
  },
  {
    segment: "communications",
    label: "Communications",
    icon: MegaphoneIcon,
    group: "Operations",
  },
  {
    segment: "documents",
    label: "Documents & Media",
    icon: FolderOpenIcon,
    group: "Operations",
  },
  {
    segment: "conference-day",
    label: "Conference Day",
    icon: CalendarCheck2Icon,
    group: "Operations",
  },
  {
    segment: "results",
    label: "Results & Awards",
    icon: AwardIcon,
    group: "Operations",
  },
  {
    segment: "certificates",
    label: "Certificates",
    icon: BadgeCheckIcon,
    group: "Operations",
  },
  {
    segment: "analytics",
    label: "Analytics",
    icon: ChartNoAxesColumnIcon,
    group: "Admin",
  },
  {
    segment: "team",
    label: "Team & Permissions",
    icon: UserCogIcon,
    group: "Admin",
  },
  {
    segment: "settings",
    label: "Settings",
    icon: SettingsIcon,
    group: "Admin",
  },
];

/** The two organizer-wide items. Not scoped to any conference. */
export interface WorkspaceNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Active only on an exact path match. `/organizer/dashboard` is a prefix of
   * every other route in the workspace, so prefix-matching it would light up
   * Overview on all 17 pages.
   */
  exact: boolean;
}

export const WORKSPACE_NAV_ITEMS: readonly WorkspaceNavItem[] = [
  {
    href: "/organizer/dashboard",
    label: "Overview",
    icon: LayoutDashboardIcon,
    exact: true,
  },
  {
    href: "/organizer/dashboard/muns",
    label: "My MUNs",
    icon: FileTextIcon,
    exact: false,
  },
];

/** `/organizer/dashboard/[munId]/{segment}` — the one place this is built. */
export function munSectionHref(munId: string, segment: string): string {
  return `/organizer/dashboard/${munId}/${segment}`;
}

/** Section metadata by segment, for breadcrumbs and page headers. */
export function getMunNavSection(segment: string): MunNavSection | undefined {
  return MUN_NAV_SECTIONS.find((section) => section.segment === segment);
}
