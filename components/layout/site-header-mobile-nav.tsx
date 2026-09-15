"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CitySelector } from "@/components/marketplace/city-selector";
import { signOutAction } from "@/app/actions/session";

/**
 * Mobile collapse for `top-nav`. Per docs/prd/DESIGN-airtable.md § Collapsing Strategy,
 * the nav collapses to a hamburger below 768px and "the menu opens as a
 * full-screen sheet rather than a dropdown" — <SheetContent> is w-full until
 * the `sm` breakpoint, which gives exactly that.
 */

interface MobileNavLink {
  href: string;
  label: string;
}

interface SiteHeaderMobileNavProps {
  links: MobileNavLink[];
  isSignedIn: boolean;
  dashboardHref: string | null;
  /**
   * Marketplace cities, when the page supplies them. The nav bar's compact
   * city picker is hidden below `md`, so it reappears here — same
   * `<CitySelector>`, same navigation, just the pill layout, which suits a
   * full-width sheet better than a dropdown inside a dropdown.
   */
  cities?: string[];
  selectedCity?: string;
}

export function SiteHeaderMobileNav({
  links,
  isSignedIn,
  dashboardHref,
  cities,
  selectedCity = "",
}: SiteHeaderMobileNavProps) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Close the sheet on navigation — Base UI keeps it open across a client
  // transition otherwise, which strands the user behind an overlay.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            // Visible until `xl` when a city picker is present: the header
            // pushes the primary link row out at that width to make room for
            // the browse cluster, so the hamburger has to cover the gap.
            className={cities ? "xl:hidden" : "md:hidden"}
            aria-label="Open menu"
          >
            <MenuIcon />
          </Button>
        }
      />
      <SheetContent side="right" className="gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>

        {cities && cities.length > 0 && (
          <div className="flex flex-col gap-xs border-b border-border px-sm pt-sm pb-md md:hidden">
            <h3 className="px-sm text-caption uppercase tracking-[0.16px] text-muted-foreground">
              City
            </h3>
            <div className="px-sm">
              <CitySelector cities={cities} selected={selectedCity} />
            </div>
          </div>
        )}

        <nav aria-label="Mobile" className="flex flex-col p-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-sm px-sm py-sm text-title-sm text-ink outline-none transition-colors duration-150 hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-surface-strong"
            >
              {link.label}
            </Link>
          ))}
          {isSignedIn && dashboardHref && (
            <Link
              href={dashboardHref}
              className="rounded-sm px-sm py-sm text-title-sm text-ink outline-none transition-colors duration-150 hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-surface-strong"
            >
              Dashboard
            </Link>
          )}
        </nav>

        <SheetFooter>
          <Button render={<Link href="/organizer/apply" />}>
            List your MUN
          </Button>
          {isSignedIn ? (
            <form action={signOutAction}>
              <Button
                type="submit"
                variant="outline"
                className="w-full"
                nativeButton
              >
                Sign out
              </Button>
            </form>
          ) : (
            <Button variant="outline" render={<Link href="/login" />}>
              Sign in
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
