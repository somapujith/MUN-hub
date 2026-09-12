import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SiteHeaderMobileNav } from "@/components/layout/site-header-mobile-nav";
import { SiteHeaderSearch } from "@/components/layout/site-header-search";
import { SiteHeaderUserMenu } from "@/components/layout/site-header-user-menu";
import { CitySelector } from "@/components/marketplace/city-selector";

/**
 * `top-nav` — DESIGN-airtable.md § Components.
 *
 * A 64px white bar pinned to the top of every page: wordmark at left, then the
 * browse cluster (city picker + search), then the action cluster at right. The
 * doc is explicit that the nav stays light on every page — it never inverts over
 * dark or signature sections, so this deliberately does NOT react to the surface
 * mode of the band beneath it.
 *
 * Elevation is a hairline, not a shadow ("color-block first, shadow second").
 *
 * ---------------------------------------------------------------------------
 * WHY `cities` IS A PROP AND NOT A FETCH IN HERE
 * ---------------------------------------------------------------------------
 * `SiteHeader` is not in `app/layout.tsx` — it's rendered per page, by 14 of
 * them, including `/dashboard`, `/admin/review`, `/login` and the three
 * `/register/[slug]` steps. Calling `getMarketplaceFacets()` inside this
 * component would add two `selectDistinct` queries over `muns` to every one of
 * those pages, most of which have nothing to do with the marketplace.
 *
 * So the city picker is opt-in: a page that already fetches facets for its own
 * body (`/` and `/muns`) passes them down, and the header renders the picker.
 * Every other page passes nothing, renders no picker, and pays no extra query.
 * The search field, which needs no data, stays on every page.
 *
 * The picker does not carry a separate "no cities loaded" state — absent props
 * simply mean "this page isn't a browse surface", which is a real distinction,
 * not a loading gap.
 *
 * ---------------------------------------------------------------------------
 * RESPONSIVE COLLAPSE (a lot of content for one 64px bar)
 * ---------------------------------------------------------------------------
 *   < 768px   wordmark + search + theme + hamburger. The city picker and the
 *             primary links move into the mobile sheet. Search stays in the bar
 *             rather than the sheet because it's the single most likely action
 *             on a phone and shouldn't cost an extra tap.
 *   768px+    city picker appears; primary nav links appear.
 *   1024px+   search grows to a comfortable 260px and "Sign in" / "List your
 *             MUN" join the right cluster.
 *
 * The bar height never changes and nothing wraps to a second row — the doc
 * specifies a fixed 64px bar, so content drops out of it instead of growing it.
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

interface SiteHeaderProps {
  /**
   * Marketplace cities. Pass from a page that already calls
   * `getMarketplaceFacets()`; omit to hide the city picker entirely.
   */
  cities?: string[];
  /** Active city from the page's own `?city=` parsing. */
  selectedCity?: string;
}

export async function SiteHeader({ cities, selectedCity = "" }: SiteHeaderProps = {}) {
  const session = await getSession();
  const showCityPicker = Boolean(cities && cities.length > 0);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="content-container flex h-16 items-center gap-sm lg:gap-md">
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

        {showCityPicker && (
          <CitySelector
            cities={cities!}
            selected={selectedCity}
            variant="compact"
            className="hidden md:inline-flex"
          />
        )}

        {/* Search takes the slack in the middle. `min-w-0` on the flex child is
            what stops the input's intrinsic width from shoving the right
            cluster off the bar at 768px. */}
        <SiteHeaderSearch
          city={selectedCity || undefined}
          className="min-w-0 flex-1 sm:max-w-[220px] lg:max-w-[260px]"
        />

        {/* `whitespace-nowrap` matters: at exactly 768px the nav is tight and
            "For organizers" otherwise wraps to two lines inside the 64px bar.
            The link row is the first thing to go when the city picker is
            present — two browse controls plus three links don't fit until xl. */}
        <nav
          aria-label="Primary"
          className={
            showCityPicker
              ? "hidden items-center gap-md xl:flex"
              : "hidden items-center gap-md md:flex lg:gap-lg"
          }
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

        <div className="ml-auto flex shrink-0 items-center gap-xs">
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
              className="hidden lg:inline-flex"
              render={<Link href="/login" />}
            >
              Sign in
            </Button>
          )}

          <Button
            size="sm"
            className="hidden h-9 lg:inline-flex"
            render={<Link href="/organizer/apply" />}
          >
            List your MUN
          </Button>

          <SiteHeaderMobileNav
            links={NAV_LINKS.map((l) => ({ ...l }))}
            isSignedIn={Boolean(session)}
            dashboardHref={session ? DASHBOARD_HREF[session.role] : null}
            cities={showCityPicker ? cities : undefined}
            selectedCity={selectedCity}
          />
        </div>
      </div>
    </header>
  );
}
