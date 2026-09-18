import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { MailIcon, MapPinIcon, PhoneIcon, ArrowRightIcon, LockIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
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
 *
 * The link grid ends in a "Stay updated" column, set off by a vertical
 * divider at md+. There's no email-list backend yet, so its form submits as
 * a `mailto:` draft to SITE_INFO.emails.hello rather than faking a real
 * subscribe — honest about what actually happens on submit.
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

/**
 * TODO(harsha): swap in the real LinkedIn URL — placeholder only, not
 * linked from the page until it's filled in for real.
 */
const SOCIAL_LINKS = {
  linkedin: "",
  instagram: "https://www.instagram.com/munhub.in/",
} as const;

function LinkedinGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-4">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.114 20.452H3.558V9h3.556v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function InstagramGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-4">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

const SOCIAL_ICONS = [
  { key: "linkedin", label: "LinkedIn", href: SOCIAL_LINKS.linkedin, Glyph: LinkedinGlyph },
  { key: "instagram", label: "Instagram", href: SOCIAL_LINKS.instagram, Glyph: InstagramGlyph },
] as const;

function ColumnHeading({ children }: { children: string }) {
  return (
    <div>
      <h2 className="text-caption font-semibold tracking-[0.08em] text-ink uppercase">
        {children}
      </h2>
      <span aria-hidden className="mt-xs block h-0.5 w-5 bg-ink" />
    </div>
  );
}

function NewsletterSignup() {
  const [email, setEmail] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    // No email-list backend exists yet — hands off to a real mailto draft
    // instead of pretending a subscribe request went anywhere.
    window.location.href = `${mailto(SITE_INFO.emails.hello)}?subject=${encodeURIComponent(
      "Subscribe me to MUN Hub updates"
    )}&body=${encodeURIComponent(trimmed)}`;
  }

  return (
    <div>
      <p className="text-caption font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        Stay updated
      </p>
      <p className="mt-sm text-title-md font-medium text-balance text-ink">
        Get the latest MUNs in your inbox
      </p>
      <p className="mt-sm text-body-md text-muted-foreground">
        New conferences, deadlines and opportunities — straight to your inbox.
      </p>
      <form onSubmit={handleSubmit} className="mt-md flex gap-2">
        <Input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Enter your email"
          aria-label="Email address"
          className="h-11"
        />
        <button
          type="submit"
          aria-label="Subscribe"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-colors duration-150 hover:bg-primary-active focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <ArrowRightIcon aria-hidden className="size-4" />
        </button>
      </form>
      <p className="mt-sm flex items-center gap-1.5 text-legal text-muted-foreground">
        <LockIcon aria-hidden className="size-3.5 shrink-0" />
        No spam. Unsubscribe anytime.
      </p>
    </div>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  const listYourMunHref = useListYourMunHref();

  return (
    <footer className="border-t border-border bg-background">
      {/* Deliberately wider than `.content-container` (1280px) — the footer
          is meant to stretch further than the header/page body above it. */}
      <div className="mx-auto w-full max-w-[1600px] px-lg py-xxl md:px-xxl md:py-section">
        <div className="grid gap-xl md:grid-cols-[1.3fr_repeat(4,0.85fr)_1.4fr] md:gap-lg">
          <div className="max-w-xs">
            <Link
              to="/"
              className="-mx-2 inline-flex items-center gap-2 rounded-sm px-2 py-1 text-label-md font-medium tracking-[-0.01em] text-ink transition-colors duration-150 hover:text-body focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              <img
                src="/images/logo-lockup.png"
                alt="MUN Hub"
                className="h-16 w-auto"
              />
            </Link>
            <p className="mt-sm text-body-md text-muted-foreground">
              A curated marketplace for Model United Nations conferences — every
              listing reviewed before it goes live.
            </p>
            <div className="mt-md flex flex-col gap-sm text-body-md text-muted-foreground">
              <div className="flex items-start gap-2">
                <MapPinIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  {SITE_INFO.legalName}
                  <br />
                  {SITE_INFO.address.line1},
                  <br />
                  {SITE_INFO.address.city}, {SITE_INFO.address.state}{" "}
                  {SITE_INFO.address.postalCode},
                  <br />
                  {SITE_INFO.address.country}
                </span>
              </div>
              <a
                href={mailto(SITE_INFO.emails.owner)}
                className="flex items-center gap-2 rounded-sm hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background focus-visible:outline-none"
              >
                <MailIcon aria-hidden className="size-4 shrink-0" />
                {SITE_INFO.emails.owner}
              </a>
              <a
                href={tel(SITE_INFO.phone)}
                className="flex items-center gap-2 rounded-sm hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background focus-visible:outline-none"
              >
                <PhoneIcon aria-hidden className="size-4 shrink-0" />
                {SITE_INFO.phoneDisplay}
              </a>
            </div>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <ColumnHeading>{column.heading}</ColumnHeading>
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

          <div className="md:border-l md:border-border md:pl-lg">
            <NewsletterSignup />
          </div>
        </div>

        <div className="mt-xxl flex flex-col gap-md border-t border-border pt-lg text-body-md text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {year} MUN Hub. All rights reserved.</p>
          <div className="flex flex-col gap-md sm:flex-row sm:items-center sm:gap-lg">
            <p>Built for delegates, secretariats, and everyone in between.</p>
            <div className="flex items-center gap-sm">
              {SOCIAL_ICONS.map(({ key, label, href, Glyph }) =>
                href ? (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={label}
                    className="inline-flex size-9 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-colors duration-150 hover:bg-primary-active focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                  >
                    <Glyph />
                  </a>
                ) : null
              )}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
