import type { MetadataRoute } from 'next'
import { listPublicMunSlugs } from '@/lib/actions/marketplace'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * Dynamic sitemap covering the homepage, marketplace listing, and every
 * publicly-visible MUN's detail page. Regenerated on request (per PRD §40).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const publicMuns = await listPublicMunSlugs()

  const munEntries: MetadataRoute.Sitemap = publicMuns.map((mun) => ({
    url: `${BASE_URL}/mun/${mun.slug}`,
    lastModified: mun.updatedAt,
    changeFrequency: 'weekly',
    priority: 0.7,
  }))

  return [
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
    ...munEntries,
  ]
}
