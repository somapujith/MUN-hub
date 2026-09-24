import { Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { RootLayout } from "@/layouts/root-layout";
import { RegisterLayout } from "@/layouts/register-layout";
import { RouteLoadingSkeleton } from "@/components/layout/route-loading-skeleton";
import { AboutPage } from "@/pages/about/about-page";
import { CurationStandardsPage } from "@/pages/about/curation-standards-page";
import { ContactPage } from "@/pages/contact-page";
import { LegalIndexPage } from "@/pages/legal/legal-index-page";
import { PrivacyPage } from "@/pages/legal/privacy-page";
import { RefundPolicyPage } from "@/pages/legal/refund-policy-page";
import { TermsPage } from "@/pages/legal/terms-page";
import { ForgotPasswordPage } from "@/pages/forgot-password-page";
import { HostAwareIndexPage } from "@/pages/host-aware-index-page";
import { LoginPage } from "@/pages/login-page";
import { MunDetailPage } from "@/pages/mun-detail-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { MunsPage } from "@/pages/muns-page";
import { ErrorPage } from "@/pages/error-page";
import { ProfilePage } from "@/pages/profile-page";
import { RequireAuth } from "@/guards/require-auth";
import { GroupManagePage } from "@/pages/dashboard/group-manage-page";
import { GroupInviteAcceptPage } from "@/pages/group-invite-accept-page";
import { RegistrationReceiptPage } from "@/pages/registration-receipt-page";
import { ResetPasswordPage } from "@/pages/reset-password-page";
import { SignupPage } from "@/pages/signup-page";
import { StudentDashboardPage } from "@/pages/student-dashboard-page";
import { CredentialsPage } from "@/pages/credentials-page";
import { VerifyEmailPage } from "@/pages/verify-email-page";
import { RegistrationPassPage } from "@/pages/dashboard/registration-pass-page";
import { StudentSupportPage } from "@/pages/student-support-page";
import { SupportNewPage } from "@/pages/support-new-page";
import {
  AdminLayout,
  AdminLoginPage,
  AdminAuditDetailPage,
  AdminAuditPage,
  AdminConferenceDetailPage,
  AdminConferencesPage,
  AdminStaffPage,
  AdminGoLiveQueuePage,
  AdminOrganizersPage,
  AdminOverviewPage,
  AdminPaymentsPage,
  AdminReportingPage,
  AdminSecurityPage,
  AdminRegistrationsPage,
  AdminReviewPage,
  AdminSupportPage,
  AdminVerificationPage,
  OrganizerLoginPage,
  OrganizerSignupPage,
  OrganizerWelcomePage,
  OrganizerOnboardingPage,
  OrganizerApplyPage,
  OrganizerResubmitPage,
  OrganizerApplySubmittedPage,
  OrganizerSupportPage,
  OrganizerMunPreviewPage,
  WorkspaceLayout,
  MunWorkspaceLayout,
  MunIndexRedirect,
  OrganizerMunsPage,
  OrganizerOverviewPage,
  OrganizerAccommodationPage,
  OrganizerAnalyticsPage,
  OrganizerCertificatesPage,
  OrganizerCommitteesPage,
  OrganizerCommunicationsPage,
  OrganizerConferenceDayPage,
  OrganizerDocumentsPage,
  OrganizerExecutiveBoardPage,
  OrganizerFormPage,
  OrganizerPaymentsPage,
  OrganizerProductsPage,
  OrganizerRegistrationsPage,
  OrganizerResultsPage,
  OrganizerSettingsPage,
  OrganizerQuickSetupPage,
  OrganizerSetupPage,
  OrganizerTeamPage,
  RegisterPage,
  GroupRegisterPage,
  RegisterPayPage,
  RegisterConfirmationPage,
} from "@/routes.lazy";

// Code-split route groups above (admin console, organizer workspace +
// onboarding, and the registration funnel) are lazy-loaded via React.lazy
// (routes.lazy.tsx) so a homepage/marketplace visitor never downloads them —
// see route-loading-skeleton.tsx and each layout's own <Suspense> boundary
// around its <Outlet /> (admin-layout.tsx, workspace-layout.tsx,
// mun-workspace-layout.tsx, register-layout.tsx) for the inner boundaries.
// `withSuspense` below covers the handful of these routes that render
// directly under RootLayout with no lazy layout of their own already
// providing a boundary.

/** Suspense boundary for a lazy route that renders directly under RootLayout,
 * i.e. has no lazy layout of its own already providing one. */
function withSuspense(element: ReactNode) {
  return <Suspense fallback={<RouteLoadingSkeleton />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        // Owns errorElement instead of the RootLayout route above so
        // ThemeProvider/Toaster/ScrollRestoration stay mounted around a
        // thrown error — only this subtree (every real page) gets replaced.
        errorElement: <ErrorPage />,
        children: [
          { index: true, element: <HostAwareIndexPage /> },
          { path: "muns", element: <MunsPage /> },
          { path: "mun/:slug", element: <MunDetailPage /> },
          { path: "about", element: <AboutPage /> },
          { path: "about/curation", element: <CurationStandardsPage /> },
          { path: "contact", element: <ContactPage /> },
          { path: "legal", element: <LegalIndexPage /> },
          { path: "legal/terms", element: <TermsPage /> },
          { path: "legal/privacy", element: <PrivacyPage /> },
          { path: "legal/refunds", element: <RefundPolicyPage /> },
          // Short aliases — the URLs people type, and what payment gateways ask
          // merchants to link during onboarding.
          { path: "terms", element: <Navigate to="/legal/terms" replace /> },
          { path: "privacy", element: <Navigate to="/legal/privacy" replace /> },
          { path: "refunds", element: <Navigate to="/legal/refunds" replace /> },
          { path: "login", element: <LoginPage /> },
          // Labelled per-role doors. Same POST /auth/session underneath — these
          // differ only in signposting and post-login destination. /admin/login is
          // intentionally unlinked from the public nav.
          { path: "organizer/login", element: withSuspense(<OrganizerLoginPage />) },
          // Organizer accounts are created here (email-code confirmed), never by
          // converting a delegate account — see lib/actions/organizer-otp.ts.
          { path: "organizer/signup", element: withSuspense(<OrganizerSignupPage />) },
          { path: "admin/login", element: withSuspense(<AdminLoginPage />) },
          { path: "signup", element: <SignupPage /> },
          { path: "forgot-password", element: <ForgotPasswordPage /> },
          { path: "reset-password", element: <ResetPasswordPage /> },
          { path: "verify-email", element: <VerifyEmailPage /> },
          {
            path: "profile",
            element: (
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            ),
          },
          {
            path: "dashboard",
            element: (
              <RequireAuth>
                <StudentDashboardPage />
              </RequireAuth>
            ),
          },
          {
            path: "dashboard/achievements",
            element: (
              <RequireAuth>
                <CredentialsPage />
              </RequireAuth>
            ),
          },
          {
            path: "dashboard/registrations/:registrationId/pass",
            element: (
              <RequireAuth>
                <RegistrationPassPage />
              </RequireAuth>
            ),
          },
          {
            path: "dashboard/support",
            element: (
              <RequireAuth>
                <StudentSupportPage />
              </RequireAuth>
            ),
          },
          {
            path: "dashboard/registrations/:registrationId/receipt",
            element: (
              <RequireAuth>
                <RegistrationReceiptPage />
              </RequireAuth>
            ),
          },
          {
            path: "support/new",
            element: (
              <RequireAuth>
                <SupportNewPage />
              </RequireAuth>
            ),
          },
          {
            path: "register/:slug",
            element: <RegisterLayout />,
            children: [
              { index: true, element: <RegisterPage /> },
              { path: "group", element: <GroupRegisterPage /> },
              { path: "pay", element: <RegisterPayPage /> },
              { path: "confirmation", element: <RegisterConfirmationPage /> },
            ],
          },
          {
            path: "group-invite",
            element: <GroupInviteAcceptPage />,
          },
          {
            path: "dashboard/groups/:groupId",
            element: (
              <RequireAuth>
                <GroupManagePage />
              </RequireAuth>
            ),
          },
          { path: "organizer/welcome", element: withSuspense(<OrganizerWelcomePage />) },
          { path: "organizer/onboarding", element: withSuspense(<OrganizerOnboardingPage />) },
          // The first MUN is applied for in the onboarding wizard; this page is for the ones after it.
          { path: "organizer/apply", element: withSuspense(<OrganizerApplyPage />) },
          // Gate-1 loop: resubmitting a CHANGES_REQUESTED application.
          { path: "organizer/apply/:munId/resubmit", element: withSuspense(<OrganizerResubmitPage />) },
          {
            path: "organizer/apply/submitted",
            element: withSuspense(<OrganizerApplySubmittedPage />),
          },
          { path: "organizer/support", element: withSuspense(<OrganizerSupportPage />) },
          { path: "organizer/muns/:munId/preview", element: withSuspense(<OrganizerMunPreviewPage />) },
          {
            path: "organizer/dashboard",
            children: [
              {
                element: withSuspense(<WorkspaceLayout />),
                children: [
                  { index: true, element: <OrganizerOverviewPage /> },
                  { path: "muns", element: <OrganizerMunsPage /> },
                ],
              },
              {
                path: ":munId",
                element: withSuspense(<MunWorkspaceLayout />),
                children: [
                  { index: true, element: <MunIndexRedirect /> },
                  { path: "quick-setup", element: <OrganizerQuickSetupPage /> },
                  { path: "setup", element: <OrganizerSetupPage /> },
                  { path: "committees", element: <OrganizerCommitteesPage /> },
                  { path: "executive-board", element: <OrganizerExecutiveBoardPage /> },
                  { path: "products", element: <OrganizerProductsPage /> },
                  { path: "form", element: <OrganizerFormPage /> },
                  { path: "accommodation", element: <OrganizerAccommodationPage /> },
                  { path: "registrations", element: <OrganizerRegistrationsPage /> },
                  { path: "finance", element: <Navigate to="../settings" replace /> },
                  { path: "communications", element: <OrganizerCommunicationsPage /> },
                  { path: "documents", element: <OrganizerDocumentsPage /> },
                  { path: "conference-day", element: <OrganizerConferenceDayPage /> },
                  { path: "results", element: <OrganizerResultsPage /> },
                  { path: "certificates", element: <OrganizerCertificatesPage /> },
                  { path: "analytics", element: <OrganizerAnalyticsPage /> },
                  { path: "payments", element: <OrganizerPaymentsPage /> },
                  { path: "team", element: <OrganizerTeamPage /> },
                  { path: "settings", element: <OrganizerSettingsPage /> },
                ],
              },
            ],
          },
          {
            path: "admin",
            element: withSuspense(<AdminLayout />),
            children: [
              { index: true, element: <AdminOverviewPage /> },
              { path: "reporting", element: <AdminReportingPage /> },
              { path: "review", element: <AdminReviewPage /> },
              { path: "verification", element: <AdminVerificationPage /> },
              { path: "go-live-queue", element: <AdminGoLiveQueuePage /> },
              { path: "muns", element: <AdminConferencesPage /> },
              { path: "muns/:munId", element: <AdminConferenceDetailPage /> },
              { path: "staff", element: <AdminStaffPage /> },
              { path: "security", element: <AdminSecurityPage /> },
              { path: "registrations", element: <AdminRegistrationsPage /> },
              { path: "payments", element: <AdminPaymentsPage /> },
              { path: "organizers", element: <AdminOrganizersPage /> },
              { path: "support", element: <AdminSupportPage /> },
              { path: "audit", element: <AdminAuditPage /> },
              {
                path: "audit/:targetType/:targetId",
                element: <AdminAuditDetailPage />,
              },
            ],
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
