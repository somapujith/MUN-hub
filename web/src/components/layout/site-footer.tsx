import { Link } from "react-router";
import { useListYourMunHref } from "@/hooks/use-list-your-mun-href";
import { SITE_INFO, mailto, tel } from "@/lib/site-info";

/**
 * `footer` — docs/prd/DESIGN-airtable.md § Navigation Variants.
 *
 * Light surface ({colors.canvas}), multi-column link list at desktop, type in
 * {typography.body-md}, footer links in {colors.muted}. Vertical padding is the
 * section constant split across an upper link block and a lower legal row.
 * Collapses to a single column below 768px.
 *
 * Flat elevation: a hairline top rule, never a shadow.
 */

const FOOTER_COLUMNS = [
  {
    heading: "Marketplace",
    links: [
      { href: "/muns", label: "Browse all MUNs" },
      { href: "/muns?sortBy=date", label: "Upcoming conferences" },
      { href: "/muns?sortBy=newest", label: "Recently added" },
      { href: "/muns?sortBy=price", label: "Lowest delegate fee" },
    ],
  },
  {
    heading: "For organizers",
    links: [
      { href: "/organizer/apply", label: "List your MUN" },
      { href: "/about/curation#review-process", label: "How verification works" },
      { href: "/about/curation#organizer-responsibilities", label: "Organizer guidelines" },
    ],
  },
  {
    heading: "About",
    links: [
      { href: "/about", label: "What is MUN Hub" },
      { href: "/about/curation", label: "Curation standards" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms of service" },
      { href: "/legal/privacy", label: "Privacy policy" },
      { href: "/legal/refunds", label: "Refund policy" },
      { href: "/legal", label: "All policies" },
    ],
  },
] as const;

/** The footer's organizer-registration link; resolved per viewer by `useListYourMunHref`. */
const LIST_YOUR_MUN_HREF = "/organizer/apply";

export function SiteFooter() {
  const year = new Date().getFullYear();
  const listYourMunHref = useListYourMunHref();

  return (
    <footer className="border-t border-border bg-background">
      <div className="content-container py-xxl md:py-section">
        <div className="grid gap-xl md:grid-cols-[1.4fr_repeat(4,1fr)] md:gap-lg">
          <div className="max-w-xs">
            <Link
              to="/"
              className="-mx-2 inline-flex items-center gap-2 rounded-sm px-2 py-1 text-label-md font-medium tracking-[-0.01em] text-ink transition-colors duration-150 hover:text-body focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              <span aria-hidden className="size-2 rounded-full bg-signature-coral" />
              <span className="font-display">MUN Hub</span>
            </Link>
            <p className="mt-sm text-body-md text-muted-foreground">
              A curated marketplace for Model United Nations conferences — every
              listing reviewed before it goes live.
            </p>
            <p className="mt-md text-body-md text-muted-foreground">
              {SITE_INFO.legalName}
              <br />
              {SITE_INFO.address.oneLine}
              <br />
              <a href={tel(SITE_INFO.phone)} className="hover:text-ink">
                {SITE_INFO.phoneDisplay}
              </a>{" "}
              &middot;{" "}
              <a href={mailto(SITE_INFO.emails.owner)} className="hover:text-ink">
                {SITE_INFO.emails.owner}
              </a>
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-caption font-medium text-ink">
                {column.heading}
              </h2>
              <ul className="mt-md flex flex-col gap-sm">
                {column.links.map((link) => {
                  // Delegate accounts never get an organizer-registration link.
                  const href = link.href === LIST_YOUR_MUN_HREF ? listYourMunHref : link.href;
                  if (!href) return null;
                  return (
                    <li key={`${column.heading}-${link.label}`}>
                      <Link
                        to={href}
                        className="rounded-sm text-body-md text-muted-foreground transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background focus-visible:outline-none"
                      >
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-xxl flex flex-col gap-sm border-t border-border pt-lg text-body-md text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {year} MUN Hub. All rights reserved.</p>
          <p>Built for delegates, secretariats, and everyone in between.</p>
        </div>
      </div>
    </footer>
  );
}
