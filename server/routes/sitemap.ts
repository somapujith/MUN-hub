import { Hono } from 'hono'
import type { Context } from 'hono'
import { listPublicMunSlugs } from '@/lib/actions/marketplace'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { AppVariables } from '../src/types'

const DEFAULT_SITE_URL = 'https://www.munhub.in'

/** Where the sitemap route is mounted (apiV1 at /api/v1, publicRoutes at /). */
const SITEMAP_PATH = '/api/v1/sitemap.xml'

/** Paths the web hosts must keep out of search results — mirrors web/public/robots.txt. */
const DISALLOWED_WEB_PATHS = ['/admin', '/organizer', '/dashboard', '/register', '/profile']

type SitemapEntry = {
  url: string
  lastModified?: Date
  changeFrequency?: string
  priority?: number
}

/** Public, indexable SPA pages (web/src/routes.tsx), besides the per-MUN pages. */
const STATIC_PAGES: Array<Omit<SitemapEntry, 'url'> & { path: string }> = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/muns', changeFrequency: 'daily', priority: 0.9 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/about/curation', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/contact', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/legal', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/legal/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/legal/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/legal/refunds', changeFrequency: 'yearly', priority: 0.3 },
]

/**
 * The public web origin the sitemap's URLs point at. Read per request via
 * getRuntimeEnv — on Workers a `process.env` read is always undefined (see
 * lib/runtime-env.ts), which silently pointed every URL at localhost.
 */
function siteUrl(): string {
  return (getRuntimeEnv('APP_URL') || DEFAULT_SITE_URL).replace(/\/+$/, '')
}

/** Absolute URL of this API's sitemap, derived from the request so it is right on every host. */
function sitemapUrl(c: Context): string {
  return new URL(SITEMAP_PATH, c.req.url).toString()
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function buildSitemapXml(entries: SitemapEntry[]): string {
  const body = entries
    .map((entry) => {
      const lines = [`  <url>`, `    <loc>${escapeXml(entry.url)}</loc>`]
      if (entry.lastModified) {
        lines.push(`    <lastmod>${entry.lastModified.toISOString()}</lastmod>`)
      }
      if (entry.changeFrequency) {
        lines.push(`    <changefreq>${entry.changeFrequency}</changefreq>`)
      }
      if (entry.priority !== undefined) {
        lines.push(`    <priority>${entry.priority}</priority>`)
      }
      lines.push('  </url>')
      return lines.join('\n')
    })
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    body,
    '</urlset>',
  ].join('\n')
}

function textResponse(c: Context, body: string) {
  return c.body(body, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
}

/**
 * `GET /robots.txt` on the API host itself (mounted in server/src/app.ts):
 * nothing here is a page, so only the sitemap may be crawled.
 */
export function apiHostRobotsTxt(c: Context) {
  return textResponse(
    c,
    ['User-agent: *', `Allow: ${SITEMAP_PATH}`, 'Disallow: /', '', `Sitemap: ${sitemapUrl(c)}`, ''].join('\n'),
  )
}

export const sitemapRoutes = new Hono<{ Variables: AppVariables }>()

sitemapRoutes.get('/sitemap.xml', async (c) => {
  const base = siteUrl()
  const publicMuns = await listPublicMunSlugs()

  const xml = buildSitemapXml([
    ...STATIC_PAGES.map(({ path, ...rest }) => ({ url: `${base}${path}`, ...rest })),
    ...publicMuns.map((mun) => ({
      url: `${base}/mun/${encodeURIComponent(mun.slug)}`,
      lastModified: mun.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.7,
    })),
  ])

  return c.body(xml, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  })
})

// The web-host rules, kept identical to web/public/robots.txt (which is what
// crawlers actually read on munhub.in and its subdomains).
sitemapRoutes.get('/robots.txt', (c) => {
  return textResponse(
    c,
    [
      'User-agent: *',
      'Allow: /',
      ...DISALLOWED_WEB_PATHS.map((path) => `Disallow: ${path}`),
      '',
      `Sitemap: ${sitemapUrl(c)}`,
      '',
    ].join('\n'),
  )
})
