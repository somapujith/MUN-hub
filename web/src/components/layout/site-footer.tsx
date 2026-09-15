import { Link } from "react-router";

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
      { href: "/organizer/apply", label: "How verification works" },
      { href: "/organizer/apply", label: "Organizer guidelines" },
    ],
  },
  {
    heading: "About",
    links: [
      { href: "/", label: "What is MUN Hub" },
      { href: "/", label: "Curation standards" },
      { href: "/", label: "Contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/", label: "Terms of service" },
      { href: "/", label: "Privacy policy" },
      { href: "/", label: "Refund policy" },
    ],
  },
] as const;

export function SiteFooter() {
  const year = new Date().getFullYear();

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
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-caption font-medium text-ink">
                {column.heading}
              </h2>
              <ul className="mt-md flex flex-col gap-sm">
                {column.links.map((link) => (
                  <li key={`${column.heading}-${link.label}`}>
                    <Link
                      to={link.href}
                      className="rounded-sm text-body-md text-muted-foreground transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background focus-visible:outline-none"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
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
