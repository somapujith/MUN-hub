import { Link, useLocation } from "react-router";
import { cn } from "cn";
import {
  MUN_NAV_GROUP_ORDER,
  MUN_NAV_SECTIONS,
  WORKSPACE_NAV_ITEMS,
  munSectionHref,
} from "@/lib/organizer/nav-config";

interface WorkspaceNavProps {
  munId: string | null;
  onNavigate?: () => void;
}

function isActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const ITEM_BASE = [
  "group/nav flex items-center gap-xs rounded-sm px-xs py-[7px]",
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

export function WorkspaceNav({ munId, onNavigate }: WorkspaceNavProps) {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Organizer workspace" className="flex flex-col gap-md">
      <ul className="flex list-none flex-col gap-px pl-xs">
        {WORKSPACE_NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href, item.exact);
          const Icon = item.icon;
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
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      {munId === null ? (
        <p className="mx-xs rounded-sm border border-dashed border-border px-sm py-xs text-body-md text-pretty text-muted-foreground">
          Pick a conference from <span className="text-ink">My MUNs</span> to manage its committees,
          registrations, and payments.
        </p>
      ) : (
        MUN_NAV_GROUP_ORDER.map((group) => {
          const sections = MUN_NAV_SECTIONS.filter((section) => section.group === group);
          if (sections.length === 0) return null;
          return (
            <div key={group} className="flex flex-col gap-px">
              <p className="px-xs pb-xxs text-[11px] font-medium tracking-[0.16px] text-muted-foreground uppercase">
                {group}
              </p>
              <ul className="flex list-none flex-col gap-px pl-xs">
                {sections.map((section) => {
                  const href = munSectionHref(munId, section.segment);
                  const active = isActive(pathname, href, false);
                  const Icon = section.icon;
                  return (
                    <li key={section.segment}>
                      <Link
                        to={href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(ITEM_BASE, active ? ITEM_ACTIVE : ITEM_IDLE)}
                      >
                        <Icon
                          aria-hidden
                          strokeWidth={1.75}
                          className={cn(ICON_BASE, active ? "text-sidebar-primary" : "text-muted-foreground")}
                        />
                        {section.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </nav>
  );
}
