import { Hono } from 'hono'
import { accommodationRoutes } from './accommodation'
import { accountRoutes } from './account'
import { adminRoutes } from './admin'
import { adminReviewRoutes } from './admin-review'
import { adminSearchRoutes } from './admin-search'
import { auditHistoryRoutes } from './audit-history'
import { certificatesRoutes } from './certificates'
import { executiveBoardRoutes } from './executive-board'
import { goLiveDashboardRoutes } from './go-live-dashboard'
import { moduleVerificationRoutes } from './module-verification'
import { munAnalyticsRoutes } from './mun-analytics'
import { munBrandingRoutes } from './mun-branding'
import { munConfigRoutes } from './mun-config'
import { munContactRoutes } from './mun-contact'
import { munDocumentsRoutes } from './mun-documents'
import { munScheduleRoutes } from './mun-schedule'
import { organizerAdminRoutes } from './organizer-admin'
import { organizerApplicationRoutes } from './organizer-application'
import { organizerConfirmationRoutes } from './organizer-confirmation'
import { organizerDashboardRoutes } from './organizer-dashboard'
import { organizerOnboardingRoutes } from './organizer-onboarding'
import { paymentSettlementRoutes } from './payment-settlement'
import { registrationFormRoutes } from './registration-form'
import { registrationsRoutes } from './registrations'
import { resultsRoutes } from './results'
import { studentDashboardRoutes } from './student-dashboard'
import { studentProfileRoutes } from './student-profile'
import { supportRoutes } from './support'
import type { AppVariables } from '../src/types'

/** Phase 2 protected route bundle — mount under `/api/v1` after session middleware. */
export const protectedRoutes = new Hono<{ Variables: AppVariables }>()

protectedRoutes.route('/', registrationsRoutes)
protectedRoutes.route('/', accountRoutes)
protectedRoutes.route('/', munConfigRoutes)
protectedRoutes.route('/', munScheduleRoutes)
protectedRoutes.route('/', munContactRoutes)
protectedRoutes.route('/', munBrandingRoutes)
protectedRoutes.route('/', munDocumentsRoutes)
protectedRoutes.route('/', executiveBoardRoutes)
protectedRoutes.route('/', certificatesRoutes)
protectedRoutes.route('/', registrationFormRoutes)
protectedRoutes.route('/', paymentSettlementRoutes)
protectedRoutes.route('/', accommodationRoutes)
protectedRoutes.route('/', goLiveDashboardRoutes)
protectedRoutes.route('/', moduleVerificationRoutes)
protectedRoutes.route('/', organizerConfirmationRoutes)
protectedRoutes.route('/', adminReviewRoutes)
protectedRoutes.route('/', organizerAdminRoutes)
protectedRoutes.route('/', adminSearchRoutes)
protectedRoutes.route('/', auditHistoryRoutes)
protectedRoutes.route('/', adminRoutes)
protectedRoutes.route('/', supportRoutes)
protectedRoutes.route('/', studentDashboardRoutes)
protectedRoutes.route('/', studentProfileRoutes)
protectedRoutes.route('/', organizerDashboardRoutes)
protectedRoutes.route('/', organizerApplicationRoutes)
protectedRoutes.route('/', organizerOnboardingRoutes)
protectedRoutes.route('/', munAnalyticsRoutes)
protectedRoutes.route('/', resultsRoutes)

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
