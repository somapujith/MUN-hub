import { Hono } from 'hono'
import { listPublicMunSlugs } from '@/lib/actions/marketplace'
import type { AppVariables } from '../src/types'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function buildSitemapXml(
  entries: Array<{
    url: string
    lastModified?: Date
    changeFrequency?: string
    priority?: number
  }>,
): string {
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

function buildRobotsTxt(): string {
  const disallow = ['/admin', '/organizer', '/dashboard', '/api', '/login', '/register']

  return [
    'User-agent: *',
    'Allow: /',
    ...disallow.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${BASE_URL}/sitemap.xml`,
  ].join('\n')
}

export const sitemapRoutes = new Hono<{ Variables: AppVariables }>()

sitemapRoutes.get('/sitemap.xml', async (c) => {
  const publicMuns = await listPublicMunSlugs()

  const xml = buildSitemapXml([
    {
      url: BASE_URL,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${BASE_URL}/muns`,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    ...publicMuns.map((mun) => ({
      url: `${BASE_URL}/mun/${mun.slug}`,
      lastModified: mun.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.7,
    })),
  ])

  return c.body(xml, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
  })
})

sitemapRoutes.get('/robots.txt', (c) => {
  return c.body(buildRobotsTxt(), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
  })
})
