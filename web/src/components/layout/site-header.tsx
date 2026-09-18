import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { SiteHeaderSidebar, accountUrlForRole } from "@/components/layout/site-header-sidebar";
import { SiteHeaderSearch } from "@/components/layout/site-header-search";
import { CitySelector } from "@/components/marketplace/city-selector";
import { SupportWidget } from "@/components/support/support-widget";
import { useSession } from "@/hooks/use-session";
import { isCrossOrigin } from "@/lib/host-routing";

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
 *   < 768px   wordmark + search + theme + hamburger. The city picker moves
 *             into the sidebar sheet. Search stays in the bar rather than
 *             the sheet because it's the single most likely action on a
 *             phone and shouldn't cost an extra tap.
 *   768px+    city picker appears in the bar.
 *   1024px+   search grows to a comfortable 260px and a single "Sign in" /
 *             "Profile" button joins the right cluster.
 *
 * The hamburger (SiteHeaderSidebar) is visible at every width, not just below
 * 768px — it's the one place both primary navigation (Marketplace) and
 * account-level utilities (notifications, help, account & settings,
 * dashboard, sign out) live, so the bar itself carries no "Marketplace" link
 * of its own — there's only ever one auth button in the bar plus one menu,
 * never a second "Create account" button competing with it.
 *
 * The bar height never changes and nothing wraps to a second row — the doc
 * specifies a fixed 64px bar, so content drops out of it instead of growing it.
 */

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

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="content-container flex h-16 items-center gap-sm lg:gap-md">
          <Link
            to="/"
            className="-mx-2 flex shrink-0 items-center gap-2 rounded-sm px-2 py-1 text-label-md font-medium tracking-[-0.01em] text-ink transition-colors duration-150 hover:text-body focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            <img
              src="/images/logo-mark.png"
              alt="MUN Hub"
              className="block h-7 w-auto shrink-0"
            />
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
  
          <div className="ml-auto flex shrink-0 items-center gap-xs">
            {session ? (
              <Button
                variant="ghost"
                size="sm"
                className="hidden lg:inline-flex"
                render={
                  isCrossOrigin(accountUrlForRole(session.role))
                    ? <a href={accountUrlForRole(session.role)} />
                    : <Link to={accountUrlForRole(session.role)} />
                }
              >
                Profile
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="hidden lg:inline-flex"
                render={<Link to="/login" />}
              >
                Sign in
              </Button>
            )}

            <SiteHeaderSidebar
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
