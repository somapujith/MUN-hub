import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SiteHeaderMobileNav } from "@/components/layout/site-header-mobile-nav";
import { SiteHeaderSearch } from "@/components/layout/site-header-search";
import { SiteHeaderUserMenu } from "@/components/layout/site-header-user-menu";
import { CitySelector } from "@/components/marketplace/city-selector";
import { SupportWidget } from "@/components/support/support-widget";
import { useSession } from "@/hooks/use-session";

/**
 * `top-nav` — docs/prd/DESIGN-airtable.md § Components.
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

const BROWSE_LINKS = [
  { href: "/muns", label: "Marketplace" },
  { href: "/muns?sortBy=date", label: "Upcoming" },
  { href: "/organizer/apply", label: "For organizers" },
] as const;

/**
 * Organizers get their own labelled door rather than sharing the delegate
 * "Sign in" button — it's the same `POST /auth/session` underneath, but the
 * separate entry point means an organizer never has to wonder whether the
 * student-facing sign-in is "the right one", and it lands them straight in the
 * organizer workspace instead of a delegate dashboard.
 *
 * Admins deliberately get NO public link: `/admin/login` exists and works, but
 * advertising a staff console entry point on a public marketplace nav invites
 * credential-stuffing at the highest-privilege door for zero user benefit.
 * Staff reach it directly (or via admin.munhub.in, which lands there).
 */
const ORGANIZER_LOGIN_LINK = { href: "/organizer/login", label: "Organizer login" } as const;

interface SiteHeaderProps {
  /**
   * Marketplace cities. Pass from a page that already calls
   * facet loading; omit to hide the city picker entirely.
   */
  cities?: string[];
  /** Active city from the page's own `?city=` parsing. */
  selectedCity?: string;
}

export function SiteHeader({ cities, selectedCity = "" }: SiteHeaderProps = {}) {
  // Read straight from the session query rather than taking a prop: the prop
  // version silently rendered a signed-OUT header on the 15 of 27 pages that
  // forgot to pass it, so being signed in looked different depending on which
  // page you were on. One source of truth, every page.
  const { data: session } = useSession();
  const showCityPicker = Boolean(cities && cities.length > 0);
  // Signed-in users already have their door; the organizer link is wayfinding
  // for people who haven't authenticated yet.
  const navLinks = session ? BROWSE_LINKS.map((l) => ({ ...l })) : [...BROWSE_LINKS, ORGANIZER_LOGIN_LINK].map((l) => ({ ...l }));

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="content-container flex h-16 items-center gap-sm lg:gap-md">
          <Link
            to="/"
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
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className="rounded-sm whitespace-nowrap text-body-md text-body transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background focus-visible:outline-none"
              >
                {link.label}
              </Link>
            ))}
          </nav>
  
          <div className="ml-auto flex shrink-0 items-center gap-xs">
            <ThemeToggle />
  
            {session ? (
              <SiteHeaderUserMenu role={session.role} />
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden lg:inline-flex"
                  render={<Link to="/login" />}
                >
                  Sign in
                </Button>
                <Button
                  size="sm"
                  className="hidden h-9 lg:inline-flex"
                  render={<Link to="/signup" />}
                >
                  Create account
                </Button>
              </>
            )}
  
  
            <SiteHeaderMobileNav
              links={navLinks}
              isSignedIn={Boolean(session)}
              role={session?.role ?? null}
              cities={showCityPicker ? cities : undefined}
              selectedCity={selectedCity}
            />
          </div>
        </div>
      </header>
      <SupportWidget />
    </>
  );
}
