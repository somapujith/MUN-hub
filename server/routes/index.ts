import { Hono } from 'hono'
import type { AppVariables } from '../src/types'
import { authRoutes } from './auth'
import { munsRoutes } from './muns'
import { protectedRoutes } from './protected'
import { sitemapRoutes } from './sitemap'

/**
 * /api/v1 route bundle — sibling agents mount domain modules here.
 * Mounted by createApp() after CSRF + rate-limit middleware.
 */
export const apiV1 = new Hono<{ Variables: AppVariables }>()

apiV1.get('/health', (c) => c.json({ ok: true, requestId: c.get('requestId') }))

apiV1.route('/auth', authRoutes)
apiV1.route('/muns', munsRoutes)
apiV1.route('/', sitemapRoutes)
apiV1.route('/', protectedRoutes)

/** @deprecated Use apiV1 — kept for sibling agents that imported publicRoutes */
export const publicRoutes = apiV1
