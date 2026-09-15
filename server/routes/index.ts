import { Hono } from 'hono'
import type { AppVariables } from '../src/types'
import { authRoutes } from './auth'
import { munsRoutes } from './muns'
import { protectedRoutes } from './protected'
import { sitemapRoutes } from './sitemap'

/** Public marketplace, auth, and SEO routes — mount at `/api/v1`. */
export const publicRoutes = new Hono<{ Variables: AppVariables }>()

publicRoutes.route('/auth', authRoutes)
publicRoutes.route('/muns', munsRoutes)
publicRoutes.route('/', sitemapRoutes)

/** Full `/api/v1` bundle — public + protected routes. */
export const apiV1 = new Hono<{ Variables: AppVariables }>()

apiV1.get('/health', (c) => c.json({ ok: true, requestId: c.get('requestId') }))

apiV1.route('/', publicRoutes)
apiV1.route('/', protectedRoutes)

export { protectedRoutes, registrationsRoutes, munConfigRoutes } from './protected'
