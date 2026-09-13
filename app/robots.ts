import type { MetadataRoute } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * Dynamic robots config (per PRD §40). Allows public marketplace/MUN pages,
 * disallows authenticated/private and transactional routes.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/organizer', '/dashboard', '/api', '/login', '/register'],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
