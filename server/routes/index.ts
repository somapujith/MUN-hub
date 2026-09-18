import { Hono } from 'hono'
import type { AppVariables } from '../src/types'
import { authRoutes } from './auth'
import { contactRoutes } from './contact'
import { emailVerificationRoutes } from './email-verification'
import { goLiveRoutes } from './go-live'
import { munsRoutes } from './muns'
import { passwordResetRoutes } from './password-reset'
import { protectedRoutes } from './protected'
import { sitemapRoutes } from './sitemap'

/** Public marketplace, auth, and SEO routes — mount at `/api/v1`. */
export const publicRoutes = new Hono<{ Variables: AppVariables }>()

publicRoutes.route('/auth', authRoutes)
publicRoutes.route('/muns', munsRoutes)
publicRoutes.route('/', passwordResetRoutes)
publicRoutes.route('/', emailVerificationRoutes)
publicRoutes.route('/', sitemapRoutes)
publicRoutes.route('/', contactRoutes)

/**
 * /api/v1 route bundle — sibling agents mount domain modules here.
 * Mounted by createApp() after CSRF + rate-limit middleware.
 */
export const apiV1 = new Hono<{ Variables: AppVariables }>()

apiV1.get('/health', (c) => c.json({ ok: true, requestId: c.get('requestId') }))

apiV1.route('/', publicRoutes)
apiV1.route('/', protectedRoutes)
apiV1.route('/', goLiveRoutes)

export { protectedRoutes, registrationsRoutes, munConfigRoutes } from './protected'
export { goLiveRoutes } from './go-live'
