import { Hono } from 'hono'
import { adminReviewRoutes } from './admin-review'
import { adminSearchRoutes } from './admin-search'
import { auditHistoryRoutes } from './audit-history'
import { munConfigRoutes } from './mun-config'
import { organizerAdminRoutes } from './organizer-admin'
import { organizerApplicationRoutes } from './organizer-application'
import { organizerDashboardRoutes } from './organizer-dashboard'
import { registrationsRoutes } from './registrations'
import { studentDashboardRoutes } from './student-dashboard'
import { supportRoutes } from './support'
import type { AppVariables } from '../src/types'

/** Phase 2 protected route bundle — mount under `/api/v1` after session middleware. */
export const protectedRoutes = new Hono<{ Variables: AppVariables }>()

protectedRoutes.route('/', registrationsRoutes)
protectedRoutes.route('/', munConfigRoutes)
protectedRoutes.route('/', adminReviewRoutes)
protectedRoutes.route('/', organizerAdminRoutes)
protectedRoutes.route('/', adminSearchRoutes)
protectedRoutes.route('/', auditHistoryRoutes)
protectedRoutes.route('/', supportRoutes)
protectedRoutes.route('/', studentDashboardRoutes)
protectedRoutes.route('/', organizerDashboardRoutes)
protectedRoutes.route('/', organizerApplicationRoutes)

export { adminReviewRoutes } from './admin-review'
export { organizerAdminRoutes } from './organizer-admin'
export { organizerDashboardRoutes } from './organizer-dashboard'
export { organizerApplicationRoutes } from './organizer-application'
export { studentDashboardRoutes } from './student-dashboard'
export { adminSearchRoutes } from './admin-search'
export { auditHistoryRoutes } from './audit-history'
export { supportRoutes } from './support'
export { registrationsRoutes } from './registrations'
export { munConfigRoutes } from './mun-config'
