import { lazy } from "react";

/**
 * Code-split route components, kept in their own module (not inline in
 * routes.tsx) so this file exports only components — mixing these with
 * routes.tsx's non-component `router` export in one file trips oxlint's
 * react-refresh-derived `only-export-components` rule on every lazy()
 * binding, even though none of them were actually exported from routes.tsx.
 *
 * Covers the admin console (admin.munhub.in), the organizer workspace +
 * onboarding (publish.munhub.in), the registration funnel
 * (register/:slug/**), and (added 2026-09-25, perf investigation — see
 * routes.tsx's `withSuspense` call sites for the route wiring) every public
 * marketing/legal/account/delegate-dashboard page that isn't needed for the
 * marketplace homepage's own first paint. Before this, routes.tsx statically
 * imported ~22 of these page components, so a plain munhub.in/www visit
 * downloaded the full source of every one of them (signup-page.tsx alone was
 * the single largest page-level contributor to the eager entry chunk) before
 * the homepage could render. See routes.tsx for how these are wired into the
 * route tree and route-loading-skeleton.tsx / each layout's own <Suspense>
 * boundary for the loading fallbacks.
 */

// --- Public/legal/account/delegate-dashboard pages, lazy since 2026-09-25 ---
// (not needed for the marketplace homepage's own first paint; MunDetailPage
// is also reached eagerly-in-effect from host-aware-index-page.tsx's "mun"
// zone branch for wildcard <slug>.munhub.in hosts, so it's imported from
// here there too, wrapped in its own <Suspense>, rather than staying a
// direct import of the real component.)
export const AboutPage = lazy(() => import("@/pages/about/about-page").then((m) => ({ default: m.AboutPage })));
export const CurationStandardsPage = lazy(() =>
  import("@/pages/about/curation-standards-page").then((m) => ({ default: m.CurationStandardsPage })),
);
export const ContactPage = lazy(() => import("@/pages/contact-page").then((m) => ({ default: m.ContactPage })));
export const LegalIndexPage = lazy(() =>
  import("@/pages/legal/legal-index-page").then((m) => ({ default: m.LegalIndexPage })),
);
export const PrivacyPage = lazy(() =>
  import("@/pages/legal/privacy-page").then((m) => ({ default: m.PrivacyPage })),
);
export const RefundPolicyPage = lazy(() =>
  import("@/pages/legal/refund-policy-page").then((m) => ({ default: m.RefundPolicyPage })),
);
export const TermsPage = lazy(() => import("@/pages/legal/terms-page").then((m) => ({ default: m.TermsPage })));
export const ForgotPasswordPage = lazy(() =>
  import("@/pages/forgot-password-page").then((m) => ({ default: m.ForgotPasswordPage })),
);
export const LoginPage = lazy(() => import("@/pages/login-page").then((m) => ({ default: m.LoginPage })));
export const MunDetailPage = lazy(() =>
  import("@/pages/mun-detail-page").then((m) => ({ default: m.MunDetailPage })),
);
export const MunsPage = lazy(() => import("@/pages/muns-page").then((m) => ({ default: m.MunsPage })));
export const ProfilePage = lazy(() => import("@/pages/profile-page").then((m) => ({ default: m.ProfilePage })));
export const GroupManagePage = lazy(() =>
  import("@/pages/dashboard/group-manage-page").then((m) => ({ default: m.GroupManagePage })),
);
export const GroupInviteAcceptPage = lazy(() =>
  import("@/pages/group-invite-accept-page").then((m) => ({ default: m.GroupInviteAcceptPage })),
);
export const RegistrationReceiptPage = lazy(() =>
  import("@/pages/registration-receipt-page").then((m) => ({ default: m.RegistrationReceiptPage })),
);
export const ResetPasswordPage = lazy(() =>
  import("@/pages/reset-password-page").then((m) => ({ default: m.ResetPasswordPage })),
);
export const SignupPage = lazy(() => import("@/pages/signup-page").then((m) => ({ default: m.SignupPage })));
export const StudentDashboardPage = lazy(() =>
  import("@/pages/student-dashboard-page").then((m) => ({ default: m.StudentDashboardPage })),
);
export const CredentialsPage = lazy(() =>
  import("@/pages/credentials-page").then((m) => ({ default: m.CredentialsPage })),
);
export const VerifyEmailPage = lazy(() =>
  import("@/pages/verify-email-page").then((m) => ({ default: m.VerifyEmailPage })),
);
export const RegistrationPassPage = lazy(() =>
  import("@/pages/dashboard/registration-pass-page").then((m) => ({ default: m.RegistrationPassPage })),
);
export const StudentSupportPage = lazy(() =>
  import("@/pages/student-support-page").then((m) => ({ default: m.StudentSupportPage })),
);
export const SupportNewPage = lazy(() =>
  import("@/pages/support-new-page").then((m) => ({ default: m.SupportNewPage })),
);

// --- Admin console (admin.munhub.in) ---
export const AdminLayout = lazy(() => import("@/layouts/admin-layout").then((m) => ({ default: m.AdminLayout })));
export const AdminLoginPage = lazy(() =>
  import("@/pages/admin/admin-login-page").then((m) => ({ default: m.AdminLoginPage })),
);
export const AdminAuditDetailPage = lazy(() =>
  import("@/pages/admin/audit-detail-page").then((m) => ({ default: m.AdminAuditDetailPage })),
);
export const AdminAuditPage = lazy(() =>
  import("@/pages/admin/audit-page").then((m) => ({ default: m.AdminAuditPage })),
);
export const AdminConferenceDetailPage = lazy(() =>
  import("@/pages/admin/conference-detail-page").then((m) => ({ default: m.AdminConferenceDetailPage })),
);
export const AdminConferencesPage = lazy(() =>
  import("@/pages/admin/conferences-page").then((m) => ({ default: m.AdminConferencesPage })),
);
export const AdminStaffPage = lazy(() =>
  import("@/pages/admin/staff-page").then((m) => ({ default: m.AdminStaffPage })),
);
export const AdminGoLiveQueuePage = lazy(() =>
  import("@/pages/admin/go-live-queue-page").then((m) => ({ default: m.AdminGoLiveQueuePage })),
);
export const AdminOrganizersPage = lazy(() =>
  import("@/pages/admin/organizers-page").then((m) => ({ default: m.AdminOrganizersPage })),
);
export const AdminOrganizerDetailPage = lazy(() =>
  import("@/pages/admin/organizer-detail-page").then((m) => ({ default: m.AdminOrganizerDetailPage })),
);
export const AdminOverviewPage = lazy(() =>
  import("@/pages/admin/overview-page").then((m) => ({ default: m.AdminOverviewPage })),
);
export const AdminPaymentsPage = lazy(() =>
  import("@/pages/admin/payments-page").then((m) => ({ default: m.AdminPaymentsPage })),
);
export const AdminReportingPage = lazy(() =>
  import("@/pages/admin/reporting-page").then((m) => ({ default: m.AdminReportingPage })),
);
export const AdminSecurityPage = lazy(() =>
  import("@/pages/admin/security-page").then((m) => ({ default: m.AdminSecurityPage })),
);
export const AdminRegistrationsPage = lazy(() =>
  import("@/pages/admin/registrations-page").then((m) => ({ default: m.AdminRegistrationsPage })),
);
export const AdminReviewPage = lazy(() =>
  import("@/pages/admin/review-page").then((m) => ({ default: m.AdminReviewPage })),
);
export const AdminSupportPage = lazy(() =>
  import("@/pages/admin/support-page").then((m) => ({ default: m.AdminSupportPage })),
);
export const AdminVerificationPage = lazy(() =>
  import("@/pages/admin/verification-page").then((m) => ({ default: m.AdminVerificationPage })),
);

// --- Organizer (publish.munhub.in): auth, onboarding, workspace ---
export const OrganizerLoginPage = lazy(() =>
  import("@/pages/organizer/organizer-login-page").then((m) => ({ default: m.OrganizerLoginPage })),
);
export const OrganizerSignupPage = lazy(() =>
  import("@/pages/organizer/organizer-signup-page").then((m) => ({ default: m.OrganizerSignupPage })),
);
export const OrganizerWelcomePage = lazy(() =>
  import("@/pages/organizer/organizer-welcome-page").then((m) => ({ default: m.OrganizerWelcomePage })),
);
export const OrganizerOnboardingPage = lazy(() =>
  import("@/pages/organizer/organizer-onboarding-page").then((m) => ({ default: m.OrganizerOnboardingPage })),
);
export const OrganizerApplyPage = lazy(() =>
  import("@/pages/organizer/organizer-apply-page").then((m) => ({ default: m.OrganizerApplyPage })),
);
export const OrganizerResubmitPage = lazy(() =>
  import("@/pages/organizer/organizer-resubmit-page").then((m) => ({ default: m.OrganizerResubmitPage })),
);
export const OrganizerApplySubmittedPage = lazy(() =>
  import("@/pages/organizer/apply-submitted-page").then((m) => ({ default: m.OrganizerApplySubmittedPage })),
);
export const OrganizerSupportPage = lazy(() =>
  import("@/pages/organizer/support-page").then((m) => ({ default: m.OrganizerSupportPage })),
);
export const OrganizerMunPreviewPage = lazy(() =>
  import("@/pages/organizer/mun-preview-page").then((m) => ({ default: m.OrganizerMunPreviewPage })),
);
export const WorkspaceLayout = lazy(() =>
  import("@/layouts/workspace-layout").then((m) => ({ default: m.WorkspaceLayout })),
);
export const MunWorkspaceLayout = lazy(() =>
  import("@/layouts/mun-workspace-layout").then((m) => ({ default: m.MunWorkspaceLayout })),
);
export const MunIndexRedirect = lazy(() =>
  import("@/pages/organizer/dashboard/mun-index-redirect").then((m) => ({ default: m.MunIndexRedirect })),
);
export const OrganizerMunsPage = lazy(() =>
  import("@/pages/organizer/dashboard/muns-page").then((m) => ({ default: m.OrganizerMunsPage })),
);
export const OrganizerOverviewPage = lazy(() =>
  import("@/pages/organizer/dashboard/overview-page").then((m) => ({ default: m.OrganizerOverviewPage })),
);
export const OrganizerAccommodationPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/accommodation-page").then((m) => ({
    default: m.OrganizerAccommodationPage,
  })),
);
export const OrganizerAnalyticsPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/analytics-page").then((m) => ({ default: m.OrganizerAnalyticsPage })),
);
export const OrganizerCertificatesPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/certificates-page").then((m) => ({
    default: m.OrganizerCertificatesPage,
  })),
);
export const OrganizerCommitteesPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/committees-page").then((m) => ({
    default: m.OrganizerCommitteesPage,
  })),
);
export const OrganizerCommunicationsPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/communications-page").then((m) => ({
    default: m.OrganizerCommunicationsPage,
  })),
);
export const OrganizerConferenceDayPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/conference_day-page").then((m) => ({
    default: m.OrganizerConferenceDayPage,
  })),
);
export const OrganizerDocumentsPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/documents-page").then((m) => ({ default: m.OrganizerDocumentsPage })),
);
export const OrganizerExecutiveBoardPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/executive_board-page").then((m) => ({
    default: m.OrganizerExecutiveBoardPage,
  })),
);
export const OrganizerFormPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/form-page").then((m) => ({ default: m.OrganizerFormPage })),
);
export const OrganizerPaymentsPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/payments-page").then((m) => ({ default: m.OrganizerPaymentsPage })),
);
export const OrganizerProductsPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/products-page").then((m) => ({ default: m.OrganizerProductsPage })),
);
export const OrganizerRegistrationsPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/registrations-page").then((m) => ({
    default: m.OrganizerRegistrationsPage,
  })),
);
export const OrganizerResultsPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/results-page").then((m) => ({ default: m.OrganizerResultsPage })),
);
export const OrganizerSettingsPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/settings-page").then((m) => ({ default: m.OrganizerSettingsPage })),
);
export const OrganizerQuickSetupPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/quick-setup-page").then((m) => ({
    default: m.OrganizerQuickSetupPage,
  })),
);
export const OrganizerSetupPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/setup-page").then((m) => ({ default: m.OrganizerSetupPage })),
);
export const OrganizerTeamPage = lazy(() =>
  import("@/pages/organizer/dashboard/sections/team-page").then((m) => ({ default: m.OrganizerTeamPage })),
);

// --- Registration funnel (register/:slug/**) ---
// Route-level lazy boundary only, per explicit instruction not to otherwise
// touch these files (a live Cashfree payment integration landed in this same
// session). RegisterLayout (layouts/register-layout.tsx, not one of the
// restricted files) already wraps its <Outlet /> in a <Suspense> using the
// existing RegistrationPageSkeleton, so these need no additional wrapping
// in routes.tsx.
export const RegisterPage = lazy(() =>
  import("@/pages/register/register-page").then((m) => ({ default: m.RegisterPage })),
);
export const GroupRegisterPage = lazy(() =>
  import("@/pages/register/group-register-page").then((m) => ({ default: m.GroupRegisterPage })),
);
export const RegisterPayPage = lazy(() =>
  import("@/pages/register/register-pay-page").then((m) => ({ default: m.RegisterPayPage })),
);
export const RegisterConfirmationPage = lazy(() =>
  import("@/pages/register/register-confirmation-page").then((m) => ({ default: m.RegisterConfirmationPage })),
);
