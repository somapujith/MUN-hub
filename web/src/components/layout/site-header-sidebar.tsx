import * as React from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BellIcon,
  BuildingIcon,
  ChevronRightIcon,
  CompassIcon,
  GlobeIcon,
  HomeIcon,
  LayoutGridIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  SproutIcon,
  UserRoundIcon,
} from "lucide-react";
import { cn } from "cn";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CitySelector } from "@/components/marketplace/city-selector";
import { signOut } from "@/api/auth";
import { inboxUrlForRole } from "@/components/support/support-labels";
import { ROLE_LABEL } from "@/components/layout/site-header-user-menu";
import { homeUrlForRole, isCrossOrigin, resolveZoneUrl } from "@/lib/host-routing";
import { useListYourMunHref } from "@/hooks/use-list-your-mun-href";
import { useSession } from "@/hooks/use-session";
import type { Role } from "@/types/enums";

/**
 * Single right-side menu for `top-nav`, shown at every breakpoint (replaces
 * the old mobile-only sheet). Houses everything that isn't the primary
 * "Sign in" / "Profile" action in the bar itself: a greeting, the
 * signed-in/out indication, account-level utilities (notifications, help,
 * account & settings, dashboard, sign out), and — since the top bar no
 * longer carries its own "Marketplace" link — primary marketplace entry
 * points too (the Explore tile, the Marketplace row, and the closing
 * "Browse MUNs" card all point at `/muns`; that redundancy mirrors the
 * reference design and is deliberate, not an oversight).
 */

interface SiteHeaderSidebarProps {
  /** Marketplace cities, when the page supplies them — mirrors the header's own city picker for md-and-below. */
  cities?: string[];
  selectedCity?: string;
}

const rowClassName =
  "flex items-center gap-sm rounded-sm px-sm py-sm text-body-md text-ink outline-none transition-colors duration-150 hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-surface-strong";

function SidebarRow({
  icon,
  label,
  url,
  disabled,
  active,
  trailing,
}: {
  icon: ReactNode;
  label: string;
  url?: string | null;
  disabled?: boolean;
  active?: boolean;
  trailing?: ReactNode;
}) {
  // Every enabled row gets a trailing chevron by default (matches the
  // reference) unless a caller supplies its own trailing content (e.g. the
  // "Soon" badge on the disabled Notifications row).
  const resolvedTrailing =
    trailing !== undefined
      ? trailing
      : !disabled && <ChevronRightIcon aria-hidden className="size-4 shrink-0" />;

  const content = (
    <>
      <span aria-hidden className={cn("[&_svg]:size-4", active ? "text-success-text" : "text-muted-foreground")}>
        {icon}
      </span>
      <span className={cn("flex-1", active && "font-semibold text-success-text")}>{label}</span>
      {resolvedTrailing}
    </>
  );

  if (disabled || !url) {
    return (
      <span
        aria-disabled="true"
        className={cn(rowClassName, "cursor-not-allowed text-muted-foreground opacity-60 hover:bg-transparent")}
      >
        {content}
      </span>
    );
  }

  const className = cn(rowClassName, active && "bg-success/10 hover:bg-success/15");

  if (isCrossOrigin(url)) {
    return (
      <a href={url} className={className} aria-current={active ? "page" : undefined}>
        {content}
      </a>
    );
  }

  return (
    <Link to={url} className={className} aria-current={active ? "page" : undefined}>
      {content}
    </Link>
  );
}

/** Where "Account & settings" sends a signed-in user — the closest thing each role has to an account page. */
export function accountUrlForRole(role: Role): string {
  if (role === "OPERATIONS" || role === "ADMIN" || role === "SUPER_ADMIN") {
    return resolveZoneUrl("admin", "/admin/security");
  }
  if (role === "STUDENT") {
    return resolveZoneUrl("student", "/profile");
  }
  return homeUrlForRole(role);
}

export function SiteHeaderSidebar({ cities, selectedCity = "" }: SiteHeaderSidebarProps) {
  const [open, setOpen] = React.useState(false);
  const { pathname } = useLocation();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSettled: () => {
      queryClient.clear();
      setOpen(false);
      navigate("/");
    },
  });

  // Close on navigation — Base UI keeps the sheet open across a client
  // transition otherwise, which strands the user behind an overlay.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const role = session?.role ?? null;
  const roleLabel = role ? ROLE_LABEL[role] : null;
  const dashboardUrl = role ? homeUrlForRole(role) : null;
  const accountUrl = role ? accountUrlForRole(role) : null;
  const helpUrl = role === "STUDENT" || role === "ORGANIZER" ? inboxUrlForRole(role) : "/contact";
  const marketplaceActive =
    pathname === "/muns" || pathname.startsWith("/muns/") || pathname.startsWith("/mun/");
  // Signed-out -> organizer sign-up, an organizer -> their host application,
  // a signed-in delegate/staff account -> hidden entirely (never a
  // role-promotion path — see CLAUDE.md "Separate organizer accounts"). The
  // same rule every other "List your MUN" CTA on the site follows.
  const listYourMunHref = useListYourMunHref();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open menu" />}>
        <MenuIcon className="size-5" />
      </SheetTrigger>

      <SheetContent side="right" className="gap-0 overflow-y-auto">
        <SheetHeader className="gap-md">
          <div className="flex items-center gap-md">
            <span
              aria-hidden
              className={cn(
                "flex size-14 shrink-0 items-center justify-center rounded-full",
                session ? "bg-success/15 text-success-text" : "bg-surface-soft text-muted-foreground"
              )}
            >
              <UserRoundIcon className="size-7" />
            </span>
            <div>
              <p className="text-body-md text-muted-foreground">
                {session ? "Welcome back," : "Welcome to"}
              </p>
              <SheetTitle className="text-title-lg">{session ? roleLabel : "MUN Hub"}</SheetTitle>
            </div>
          </div>

          {session ? (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success/12 px-sm py-xs text-body-md font-medium text-success-text">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success-text" />
              Signed in as {roleLabel}
            </span>
          ) : (
            <div className="flex flex-col gap-sm">
              <span className="inline-flex w-fit items-center rounded-full bg-surface-soft px-sm py-xs text-body-md font-medium text-muted-foreground">
                Not signed in
              </span>
              <div className="flex flex-wrap gap-xs">
                <Button size="sm" render={<Link to="/login" />}>
                  Sign in
                </Button>
                <Button size="sm" variant="outline" render={<Link to="/signup" />}>
                  Create account
                </Button>
              </div>
            </div>
          )}
        </SheetHeader>

        <div className="p-sm">
          <Link
            to="/muns"
            className="flex items-center gap-sm rounded-md bg-success/8 p-sm transition-colors duration-150 hover:bg-success/12 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success/15 text-success-text"
            >
              <SproutIcon className="size-5" />
            </span>
            <span className="flex-1">
              <span className="block text-body-md font-semibold text-ink">Explore conferences</span>
              <span className="block text-body-md text-muted-foreground">
                Browse every MUN listed on MUN Hub.
              </span>
            </span>
            <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-success-text" />
          </Link>
        </div>

        {cities && cities.length > 0 && (
          <div className="flex flex-col gap-xs border-b border-border px-sm pt-sm pb-md md:hidden">
            <h3 className="px-sm text-caption uppercase tracking-[0.16px] text-muted-foreground">City</h3>
            <div className="px-sm">
              <CitySelector cities={cities} selected={selectedCity} />
            </div>
          </div>
        )}

        <nav aria-label="Primary" className="flex flex-col gap-0 border-b border-border p-sm">
          <SidebarRow icon={<HomeIcon />} label="Marketplace" url="/muns" active={marketplaceActive} />
          {listYourMunHref && (
            <SidebarRow icon={<BuildingIcon />} label="List your MUN" url={listYourMunHref} />
          )}
          <SidebarRow
            icon={<BellIcon />}
            label="Notifications"
            disabled
            trailing={
              <Badge variant="outline" className="shrink-0">
                Soon
              </Badge>
            }
          />
          <SidebarRow icon={<CompassIcon />} label="Help & support" url={helpUrl} />
          <SidebarRow
            icon={<SettingsIcon />}
            label="Account & settings"
            url={accountUrl}
            disabled={!accountUrl}
          />
          {session && dashboardUrl && (
            <SidebarRow icon={<LayoutGridIcon />} label="Dashboard" url={dashboardUrl} />
          )}
        </nav>

        <div className="p-sm">
          <div className="relative overflow-hidden rounded-lg bg-info/8 p-lg">
            <GlobeIcon
              aria-hidden
              className="pointer-events-none absolute -right-5 -bottom-5 size-28 text-info/15"
            />
            <div className="relative max-w-[85%]">
              <p className="text-title-sm font-semibold text-balance text-ink">
                Be part of a bigger conversation.
              </p>
              <p className="mt-xs text-body-md text-muted-foreground">
                Discover global perspectives through Model UN.
              </p>
              <Link
                to="/muns"
                className="mt-md inline-flex items-center gap-1 rounded-full bg-background px-md py-xs text-body-md font-medium text-info-text shadow-sm transition-colors duration-150 hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
              >
                Browse MUNs
                <ChevronRightIcon aria-hidden className="size-4" />
              </Link>
            </div>
          </div>
        </div>

        <SheetFooter className="mt-auto gap-sm">
          {session && (
            <button
              type="button"
              disabled={signOutMutation.isPending}
              onClick={() => signOutMutation.mutate()}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-destructive/20 bg-destructive/8 px-md py-sm text-body-md font-medium text-destructive-text transition-colors duration-150 hover:bg-destructive/14 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
            >
              <LogOutIcon aria-hidden className="size-4" />
              {signOutMutation.isPending ? "Signing out…" : "Sign out"}
            </button>
          )}

          <div className={cn("flex items-center justify-between gap-sm pt-sm", session && "border-t border-border")}>
            <img src="/images/logo-lockup.png" alt="MUN Hub" className="h-8 w-auto" />
            <p className="text-right text-legal text-muted-foreground">
              Better delegates.
              <br />
              Better MUNs.
            </p>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
