import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SiteHeaderMobileNav } from "@/components/layout/site-header-mobile-nav";
import { SiteHeaderUserMenu } from "@/components/layout/site-header-user-menu";

/**
 * `top-nav` — DESIGN-airtable.md § Components.
 *
 * A 64px white bar pinned to the top of every page: wordmark at left, primary
 * horizontal menu center-left in {typography.body-md}, and the action cluster
 * at right. The doc is explicit that the nav stays light on every page —
 * it never inverts over dark or signature sections, so this deliberately does
 * NOT react to the surface mode of the band beneath it.
 *
 * Elevation is a hairline, not a shadow ("color-block first, shadow second").
 */

const NAV_LINKS = [
  { href: "/muns", label: "Marketplace" },
  { href: "/muns?sortBy=date", label: "Upcoming" },
  { href: "/organizer/apply", label: "For organizers" },
] as const;

/** Role → the dashboard that role actually lands on. */
const DASHBOARD_HREF = {
  STUDENT: "/dashboard",
  ORGANIZER: "/organizer",
  OPERATIONS: "/admin",
  ADMIN: "/admin",
  SUPER_ADMIN: "/admin",
} as const;

export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="content-container flex h-16 items-center gap-lg">
        <Link
          href="/"
          className="-mx-2 flex shrink-0 items-center gap-2 rounded-sm px-2 py-1 text-label-md font-medium tracking-[-0.01em] text-ink transition-colors duration-150 hover:text-body focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          {/* Wordmark: the only place the coral signature color is allowed at
              small scale — as a 8px dot, not a surface. */}
          <span
            aria-hidden
            className="size-2 rounded-full bg-signature-coral"
          />
          <span className="font-display">MUN Hub</span>
        </Link>

        {/* `whitespace-nowrap` matters: at exactly 768px the nav is tight and
            "For organizers" otherwise wraps to two lines inside the 64px bar. */}
        <nav
          aria-label="Primary"
          className="hidden items-center gap-md md:flex lg:gap-lg"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-sm whitespace-nowrap text-body-md text-body transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-xs">
          <ThemeToggle />

          {session ? (
            <SiteHeaderUserMenu
              role={session.role}
              dashboardHref={DASHBOARD_HREF[session.role]}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              render={<Link href="/login" />}
            >
              Sign in
            </Button>
          )}

          <Button
            size="sm"
            className="hidden h-9 sm:inline-flex"
            render={<Link href="/organizer/apply" />}
          >
            List your MUN
          </Button>

          <SiteHeaderMobileNav
            links={NAV_LINKS.map((l) => ({ ...l }))}
            isSignedIn={Boolean(session)}
            dashboardHref={session ? DASHBOARD_HREF[session.role] : null}
          />
        </div>
      </div>
    </header>
  );
}
