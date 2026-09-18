import type { MunDetail } from "../types";
import {
  DEFAULT_OG_IMAGE,
  DEFAULT_OG_IMAGE_ALT,
  SITE_NAME,
  absoluteHttpUrl,
  buildMunEventJsonLd,
  canonicalUrl,
  metaDescription,
  serializeJsonLd,
} from "./seo";

/**
 * Shared by both platforms that serve munhub.in in production: the
 * Cloudflare Worker (web/src/server/social-preview-worker.ts, handles
 * app./publish./admin.munhub.in and the *.munhub.in per-MUN wildcard) and the
 * Vercel deployment (web/api/social-preview.ts, handles the canonical
 * www.munhub.in/mun/:slug — see web/vercel.json's rewrite).
 *
 * Why this exists at all: react-helmet-async (components/seo/page-meta.tsx)
 * only rewrites <head> after React hydrates in a real browser. Link-unfurl
 * bots (Instagram DM, WhatsApp, Facebook, Twitter/X, LinkedIn, Slack,
 * Discord) and most search crawlers never run that JS, so both platforms
 * need a non-JS fallback that serves the same correct tags.
 */

const FETCH_TIMEOUT_MS = 3000;

// Non-exhaustive but covers every major link-unfurl bot plus the mainstream
// search crawlers; anything unmatched gets the unmodified SPA shell instead.
// Keep in sync with the `has` header regex in web/vercel.json's rewrite.
export const CRAWLER_USER_AGENT =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|WhatsApp|TelegramBot|Discordbot|Googlebot|bingbot|DuckDuckBot|Applebot|Pinterest|redditbot|vkShare|Skype|ia_archiver|YandexBot/i;

export function isCrawlerUserAgent(userAgent: string | null): boolean {
  return userAgent !== null && CRAWLER_USER_AGENT.test(userAgent);
}

/** Parses the wire shape (dates as ISO strings) into what buildMunEventJsonLd expects. */
function normalizeMun(raw: Record<string, unknown>): MunDetail {
  const toDate = (value: unknown): Date | null => (typeof value === "string" ? new Date(value) : null);
  return {
    ...raw,
    startDate: toDate(raw.startDate),
    endDate: toDate(raw.endDate),
    registrationOpensAt: toDate(raw.registrationOpensAt),
    registrationDeadline: toDate(raw.registrationDeadline),
  } as unknown as MunDetail;
}

export async function fetchMunForSocialPreview(slug: string, apiBaseUrl: string): Promise<MunDetail | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/muns/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return normalizeMun((await response.json()) as Record<string, unknown>);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface SocialPreviewHead {
  title: string;
  description: string;
  /** <link>/<meta>/<script> tags for <head>, already HTML-escaped. */
  headHtml: string;
}

export function buildSocialPreviewHead(mun: MunDetail): SocialPreviewHead {
  const url = canonicalUrl(`/mun/${mun.slug}`);
  const title = `${mun.name} | ${SITE_NAME}`;
  const where = [mun.city, mun.country].filter(Boolean).join(", ");
  const description = metaDescription(
    mun.description ?? mun.theme,
    `${mun.name}${where ? ` in ${where}` : ""} — committees, schedule, fees and registration on MUN Hub.`,
  );
  const image = absoluteHttpUrl(mun.coverImage) ?? DEFAULT_OG_IMAGE;
  const imageAlt = mun.coverImage ? `${mun.name} cover image` : DEFAULT_OG_IMAGE_ALT;
  const jsonLd = buildMunEventJsonLd(mun, {});

  const t = escapeAttr(title);
  const d = escapeAttr(description);
  const alt = escapeAttr(imageAlt);

  const tags = [
    `<link rel="canonical" href="${url}">`,
    `<meta name="description" content="${d}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:alt" content="${alt}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<meta name="twitter:image:alt" content="${alt}">`,
  ];
  if (jsonLd) {
    tags.push(`<script type="application/ld+json">${serializeJsonLd(jsonLd)}</script>`);
  }

  return { title, description, headHtml: tags.join("\n") };
}

/**
 * A complete, standalone HTML document for a bot request — used where there
 * is no real SPA response to graft tags onto (Vercel's api/social-preview.ts;
 * the Cloudflare worker instead rewrites the real asset response in place).
 * Bots never execute JS, so this doesn't need the real Vite bundle at all.
 */
export function buildSocialPreviewDocument(mun: MunDetail): string {
  const { title, description, headHtml } = buildSocialPreviewHead(mun);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    `<title>${escapeAttr(title)}</title>`,
    headHtml,
    "</head>",
    "<body>",
    `<h1>${escapeAttr(mun.name)}</h1>`,
    `<p>${escapeAttr(description)}</p>`,
    "</body>",
    "</html>",
  ].join("\n");
}
