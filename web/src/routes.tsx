import { Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { RootLayout } from "@/layouts/root-layout";
import { RegisterLayout } from "@/layouts/register-layout";
import { RouteLoadingSkeleton } from "@/components/layout/route-loading-skeleton";
import { HostAwareIndexPage } from "@/pages/host-aware-index-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { ErrorPage } from "@/pages/error-page";
import { RequireAuth } from "@/guards/require-auth";
import {
  AboutPage,
  CurationStandardsPage,
  ContactPage,
  LegalIndexPage,
  PrivacyPage,
  RefundPolicyPage,
  TermsPage,
  ForgotPasswordPage,
  LoginPage,
  MunDetailPage,
  MunsPage,
  ProfilePage,
  GroupManagePage,
  GroupInviteAcceptPage,
  RegistrationReceiptPage,
  ResetPasswordPage,
  SignupPage,
  StudentDashboardPage,
  CredentialsPage,
  VerifyEmailPage,
  RegistrationPassPage,
  StudentSupportPage,
  SupportNewPage,
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
          { path: "muns", element: withSuspense(<MunsPage />) },
          { path: "mun/:slug", element: withSuspense(<MunDetailPage />) },
          { path: "about", element: withSuspense(<AboutPage />) },
          { path: "about/curation", element: withSuspense(<CurationStandardsPage />) },
          { path: "contact", element: withSuspense(<ContactPage />) },
          { path: "legal", element: withSuspense(<LegalIndexPage />) },
          { path: "legal/terms", element: withSuspense(<TermsPage />) },
          { path: "legal/privacy", element: withSuspense(<PrivacyPage />) },
          { path: "legal/refunds", element: withSuspense(<RefundPolicyPage />) },
          // Short aliases — the URLs people type, and what payment gateways ask
          // merchants to link during onboarding.
          { path: "terms", element: <Navigate to="/legal/terms" replace /> },
          { path: "privacy", element: <Navigate to="/legal/privacy" replace /> },
          { path: "refunds", element: <Navigate to="/legal/refunds" replace /> },
          { path: "login", element: withSuspense(<LoginPage />) },
          // Labelled per-role doors. Same POST /auth/session underneath — these
          // differ only in signposting and post-login destination. /admin/login is
          // intentionally unlinked from the public nav.
          // The only organizer door: logging in with an email that has no
          // account yet creates it (email-code confirmed) — never by converting
          // a delegate account. See lib/actions/organizer-otp.ts.
          { path: "organizer/login", element: withSuspense(<OrganizerLoginPage />) },
          // Kept only so old links/bookmarks still resolve; redirects to /organizer/login.
          { path: "organizer/signup", element: withSuspense(<OrganizerSignupPage />) },
          { path: "admin/login", element: withSuspense(<AdminLoginPage />) },
          { path: "signup", element: withSuspense(<SignupPage />) },
          { path: "forgot-password", element: withSuspense(<ForgotPasswordPage />) },
          { path: "reset-password", element: withSuspense(<ResetPasswordPage />) },
          { path: "verify-email", element: withSuspense(<VerifyEmailPage />) },
          {
            path: "profile",
            element: withSuspense(
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>,
            ),
          },
          {
            path: "dashboard",
            element: withSuspense(
              <RequireAuth>
                <StudentDashboardPage />
              </RequireAuth>,
            ),
          },
          {
            path: "dashboard/achievements",
            element: withSuspense(
              <RequireAuth>
                <CredentialsPage />
              </RequireAuth>,
            ),
          },
          {
            path: "dashboard/registrations/:registrationId/pass",
            element: withSuspense(
              <RequireAuth>
                <RegistrationPassPage />
              </RequireAuth>,
            ),
          },
          {
            path: "dashboard/support",
            element: withSuspense(
              <RequireAuth>
                <StudentSupportPage />
              </RequireAuth>,
            ),
          },
          {
            path: "dashboard/registrations/:registrationId/receipt",
            element: withSuspense(
              <RequireAuth>
                <RegistrationReceiptPage />
              </RequireAuth>,
            ),
          },
          {
            path: "support/new",
            element: withSuspense(
              <RequireAuth>
                <SupportNewPage />
              </RequireAuth>,
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
            element: withSuspense(<GroupInviteAcceptPage />),
          },
          {
            path: "dashboard/groups/:groupId",
            element: withSuspense(
              <RequireAuth>
                <GroupManagePage />
              </RequireAuth>,
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
