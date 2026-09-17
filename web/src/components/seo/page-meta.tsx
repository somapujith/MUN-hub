import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import {
  canonicalUrl,
  DEFAULT_OG_IMAGE,
  DEFAULT_OG_IMAGE_ALT,
  serializeJsonLd,
  SITE_NAME,
} from "@/lib/seo";

/**
 * Title, description, canonical link, Open Graph + Twitter tags and optional
 * JSON-LD for one public page.
 *
 * web/index.html carries site-wide Open Graph defaults (marked
 * `data-default-seo`) for crawlers that never run JavaScript. Once a page
 * renders its own tags those defaults would only be duplicates, so they are
 * removed on mount — they are never needed again in a running SPA.
 */

interface PageMetaProps {
  /** Full document title, e.g. "Browse MUNs | MUN Hub". */
  title: string;
  description: string;
  /** App path for the canonical URL (query and hash are ignored). */
  path: string;
  /** Absolute image URL; falls back to the site's default card. */
  image?: string | null;
  imageAlt?: string;
  type?: "website" | "article";
  /** Adds `robots: noindex` (404s and other pages search engines should skip). */
  noindex?: boolean;
  /** Omit the canonical link (e.g. a 404, which has no canonical address). */
  omitCanonical?: boolean;
  jsonLd?: Record<string, unknown> | null;
}

export function PageMeta({
  title,
  description,
  path,
  image,
  imageAlt,
  type = "website",
  noindex = false,
  omitCanonical = false,
  jsonLd,
}: PageMetaProps) {
  useEffect(() => {
    document.head.querySelectorAll("[data-default-seo]").forEach((node) => node.remove());
  }, []);

  const url = canonicalUrl(path);
  const ogImage = image ?? DEFAULT_OG_IMAGE;
  const ogImageAlt = image ? (imageAlt ?? title) : DEFAULT_OG_IMAGE_ALT;

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      {noindex && <meta name="robots" content="noindex, follow" />}
      {!omitCanonical && <link rel="canonical" href={url} />}

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {!omitCanonical && <meta property="og:url" content={url} />}
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:alt" content={ogImageAlt} />
      {!image && <meta property="og:image:width" content="1200" />}
      {!image && <meta property="og:image:height" content="630" />}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      <meta name="twitter:image:alt" content={ogImageAlt} />

      {jsonLd && <script type="application/ld+json">{serializeJsonLd(jsonLd)}</script>}
    </Helmet>
  );
}
