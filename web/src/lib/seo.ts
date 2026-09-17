import type { MunDetail } from "@/types";

/**
 * SEO vocabulary for the public pages (home, /muns, /mun/:slug).
 *
 * Canonical URLs always point at the marketplace host, whichever host served
 * the page — a MUN page is also reachable as `<slug>.munhub.in` and on local
 * dev hosts, and search engines should index exactly one address for it.
 */

export const SITE_ORIGIN = "https://www.munhub.in";
export const SITE_NAME = "MUN Hub";
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-default.png`;
export const DEFAULT_OG_IMAGE_ALT = "MUN Hub — find and register for Model UN conferences";
export const DEFAULT_DESCRIPTION =
  "Browse reviewed Model United Nations conferences, compare committees and fees, and register for your next MUN in minutes.";

const DESCRIPTION_MAX_LENGTH = 160;

/** Absolute canonical URL on the marketplace host for an app path (query and hash dropped). */
export function canonicalUrl(path: string): string {
  const [pathname] = path.split(/[?#]/);
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${SITE_ORIGIN}${normalized}`;
}

/** Only an absolute http(s) URL is usable as og:image or in JSON-LD; anything else is dropped. */
export function absoluteHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Collapses whitespace and trims to a meta-description length on a word boundary. */
export function metaDescription(text: string | null | undefined, fallback: string): string {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return fallback;
  if (collapsed.length <= DESCRIPTION_MAX_LENGTH) return collapsed;
  const cut = collapsed.slice(0, DESCRIPTION_MAX_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Serializes JSON-LD for an inline <script>. `<`, `>` and `&` are escaped so
 * organizer-written text (a MUN name containing `</script>`) can never close
 * the script element early.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

type JsonLd = Record<string, unknown>;

function withoutEmpty(record: JsonLd): JsonLd {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined && value !== ""),
  );
}

/**
 * schema.org `Event` for a MUN page. Returns null when the MUN has no start
 * date yet — an Event without one is invalid structured data, and emitting it
 * would only earn a Search Console error.
 */
export function buildMunEventJsonLd(
  mun: MunDetail,
  options: { soldOutProductIds?: ReadonlySet<string> } = {},
): JsonLd | null {
  if (!mun.startDate) return null;

  const url = canonicalUrl(`/mun/${mun.slug}`);
  const image = absoluteHttpUrl(mun.coverImage);
  const website = mun.contact?.website?.trim();
  // Organizers often type a bare domain ("deccanmun.org"); treat it as https.
  const organizerUrl = absoluteHttpUrl(
    website && !/^[a-z][a-z0-9+.-]*:/i.test(website) ? `https://${website}` : website,
  );

  const availabilityFor = (productId: string): string | null => {
    if (mun.status === "REGISTRATION_OPEN") {
      return options.soldOutProductIds?.has(productId)
        ? "https://schema.org/SoldOut"
        : "https://schema.org/InStock";
    }
    if (mun.status === "PUBLISHED") return "https://schema.org/PreOrder";
    return null;
  };

  const offers = mun.registrationProducts.map((product) =>
    withoutEmpty({
      "@type": "Offer",
      name: product.name,
      price: product.price,
      priceCurrency: product.currency ?? "INR",
      availability: availabilityFor(product.id),
      validFrom: mun.registrationOpensAt?.toISOString(),
      url,
    }),
  );

  const address = withoutEmpty({
    "@type": "PostalAddress",
    streetAddress: mun.addressLine1,
    addressLocality: mun.city,
    addressRegion: mun.addressState,
    postalCode: mun.postalCode,
    addressCountry: mun.country,
  });

  return withoutEmpty({
    "@context": "https://schema.org",
    "@type": "Event",
    name: mun.name,
    description: metaDescription(mun.description ?? mun.theme, `${mun.name} — a Model United Nations conference.`),
    url,
    startDate: mun.startDate.toISOString(),
    endDate: (mun.endDate ?? mun.startDate).toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: withoutEmpty({
      "@type": "Place",
      name: mun.venue ?? ([mun.city, mun.country].filter(Boolean).join(", ") || null),
      address,
    }),
    image: image ? [image] : null,
    organizer: mun.organizerName
      ? withoutEmpty({ "@type": "Organization", name: mun.organizerName, url: organizerUrl })
      : null,
    offers: offers.length > 0 ? offers : null,
  });
}
