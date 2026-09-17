import { createBrowserRouter, Navigate } from "react-router";
import { AdminLayout } from "@/layouts/admin-layout";
import { MunWorkspaceLayout } from "@/layouts/mun-workspace-layout";
import { RegisterLayout } from "@/layouts/register-layout";
import { RootLayout } from "@/layouts/root-layout";
import { WorkspaceLayout } from "@/layouts/workspace-layout";
import { AdminAuditDetailPage } from "@/pages/admin/audit-detail-page";
import { AdminAuditPage } from "@/pages/admin/audit-page";
import { AdminConferenceDetailPage } from "@/pages/admin/conference-detail-page";
import { AdminConferencesPage } from "@/pages/admin/conferences-page";
import { AdminStaffPage } from "@/pages/admin/staff-page";
import { AdminGoLiveQueuePage } from "@/pages/admin/go-live-queue-page";
import { AdminOrganizersPage } from "@/pages/admin/organizers-page";
import { AdminOverviewPage } from "@/pages/admin/overview-page";
import { AdminPaymentsPage } from "@/pages/admin/payments-page";
import { AdminRegistrationsPage } from "@/pages/admin/registrations-page";
import { AdminReviewPage } from "@/pages/admin/review-page";
import { AdminSupportPage } from "@/pages/admin/support-page";
import { AdminVerificationPage } from "@/pages/admin/verification-page";
import { AboutPage } from "@/pages/about/about-page";
import { CurationStandardsPage } from "@/pages/about/curation-standards-page";
import { ContactPage } from "@/pages/contact-page";
import { LegalIndexPage } from "@/pages/legal/legal-index-page";
import { PrivacyPage } from "@/pages/legal/privacy-page";
import { RefundPolicyPage } from "@/pages/legal/refund-policy-page";
import { TermsPage } from "@/pages/legal/terms-page";
import { ForgotPasswordPage } from "@/pages/forgot-password-page";
import { HostAwareIndexPage } from "@/pages/host-aware-index-page";
import { AdminLoginPage } from "@/pages/admin/admin-login-page";
import { LoginPage } from "@/pages/login-page";
import { OrganizerLoginPage } from "@/pages/organizer/organizer-login-page";
import { MunDetailPage } from "@/pages/mun-detail-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { OrganizerApplySubmittedPage } from "@/pages/organizer/apply-submitted-page";
import { OrganizerSignupPage } from "@/pages/organizer/organizer-signup-page";
import { OrganizerWelcomePage } from "@/pages/organizer/organizer-welcome-page";
import { OrganizerOnboardingPage } from "@/pages/organizer/organizer-onboarding-page";
import { OrganizerApplyPage } from "@/pages/organizer/organizer-apply-page";
import { OrganizerSupportPage } from "@/pages/organizer/support-page";
import { OrganizerMunPreviewPage } from "@/pages/organizer/mun-preview-page";
import { MunIndexRedirect } from "@/pages/organizer/dashboard/mun-index-redirect";
import { OrganizerMunsPage } from "@/pages/organizer/dashboard/muns-page";
import { OrganizerOverviewPage } from "@/pages/organizer/dashboard/overview-page";
import { OrganizerAccommodationPage } from "@/pages/organizer/dashboard/sections/accommodation-page";
import { OrganizerAnalyticsPage } from "@/pages/organizer/dashboard/sections/analytics-page";
import { OrganizerCertificatesPage } from "@/pages/organizer/dashboard/sections/certificates-page";
import { OrganizerCommitteesPage } from "@/pages/organizer/dashboard/sections/committees-page";
import { OrganizerCommunicationsPage } from "@/pages/organizer/dashboard/sections/communications-page";
import { OrganizerConferenceDayPage } from "@/pages/organizer/dashboard/sections/conference_day-page";
import { OrganizerDocumentsPage } from "@/pages/organizer/dashboard/sections/documents-page";
import { OrganizerExecutiveBoardPage } from "@/pages/organizer/dashboard/sections/executive_board-page";
import { OrganizerFinancePage } from "@/pages/organizer/dashboard/sections/finance-page";
import { OrganizerFormPage } from "@/pages/organizer/dashboard/sections/form-page";
import { OrganizerProductsPage } from "@/pages/organizer/dashboard/sections/products-page";
import { OrganizerRegistrationsPage } from "@/pages/organizer/dashboard/sections/registrations-page";
import { OrganizerResultsPage } from "@/pages/organizer/dashboard/sections/results-page";
import { OrganizerSettingsPage } from "@/pages/organizer/dashboard/sections/settings-page";
import { OrganizerSetupPage } from "@/pages/organizer/dashboard/sections/setup-page";
import { OrganizerTeamPage } from "@/pages/organizer/dashboard/sections/team-page";
import { MunsPage } from "@/pages/muns-page";
import { ProfilePage } from "@/pages/profile-page";
import { RequireAuth } from "@/guards/require-auth";
import { RegisterConfirmationPage } from "@/pages/register/register-confirmation-page";
import { RegisterPage } from "@/pages/register/register-page";
import { RegisterPayPage } from "@/pages/register/register-pay-page";
import { RegistrationReceiptPage } from "@/pages/registration-receipt-page";
import { ResetPasswordPage } from "@/pages/reset-password-page";
import { SignupPage } from "@/pages/signup-page";
import { StudentDashboardPage } from "@/pages/student-dashboard-page";
import { VerifyEmailPage } from "@/pages/verify-email-page";
import { RegistrationPassPage } from "@/pages/dashboard/registration-pass-page";
import { StudentSupportPage } from "@/pages/student-support-page";
import { SupportNewPage } from "@/pages/support-new-page";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
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
      { path: "organizer/login", element: <OrganizerLoginPage /> },
      // Organizer accounts are created here (email-code confirmed), never by
      // converting a delegate account — see lib/actions/organizer-otp.ts.
      { path: "organizer/signup", element: <OrganizerSignupPage /> },
      { path: "admin/login", element: <AdminLoginPage /> },
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
          { path: "pay", element: <RegisterPayPage /> },
          { path: "confirmation", element: <RegisterConfirmationPage /> },
        ],
      },
      { path: "organizer/welcome", element: <OrganizerWelcomePage /> },
      { path: "organizer/onboarding", element: <OrganizerOnboardingPage /> },
      // The first MUN is applied for in the onboarding wizard; this page is for the ones after it.
      { path: "organizer/apply", element: <OrganizerApplyPage /> },
      {
        path: "organizer/apply/submitted",
        element: <OrganizerApplySubmittedPage />,
      },
      { path: "organizer/support", element: <OrganizerSupportPage /> },
      { path: "organizer/muns/:munId/preview", element: <OrganizerMunPreviewPage /> },
      {
        path: "organizer/dashboard",
        children: [
          {
            element: <WorkspaceLayout />,
            children: [
              { index: true, element: <OrganizerOverviewPage /> },
              { path: "muns", element: <OrganizerMunsPage /> },
            ],
          },
          {
            path: ":munId",
            element: <MunWorkspaceLayout />,
            children: [
              { index: true, element: <MunIndexRedirect /> },
              { path: "setup", element: <OrganizerSetupPage /> },
              { path: "committees", element: <OrganizerCommitteesPage /> },
              { path: "executive-board", element: <OrganizerExecutiveBoardPage /> },
              { path: "products", element: <OrganizerProductsPage /> },
              { path: "form", element: <OrganizerFormPage /> },
              { path: "accommodation", element: <OrganizerAccommodationPage /> },
              { path: "registrations", element: <OrganizerRegistrationsPage /> },
              { path: "finance", element: <OrganizerFinancePage /> },
              { path: "communications", element: <OrganizerCommunicationsPage /> },
              { path: "documents", element: <OrganizerDocumentsPage /> },
              { path: "conference-day", element: <OrganizerConferenceDayPage /> },
              { path: "results", element: <OrganizerResultsPage /> },
              { path: "certificates", element: <OrganizerCertificatesPage /> },
              { path: "analytics", element: <OrganizerAnalyticsPage /> },
              { path: "team", element: <OrganizerTeamPage /> },
              { path: "settings", element: <OrganizerSettingsPage /> },
            ],
          },
        ],
      },
      {
        path: "admin",
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminOverviewPage /> },
          { path: "review", element: <AdminReviewPage /> },
          { path: "verification", element: <AdminVerificationPage /> },
          { path: "go-live-queue", element: <AdminGoLiveQueuePage /> },
          { path: "muns", element: <AdminConferencesPage /> },
          { path: "muns/:munId", element: <AdminConferenceDetailPage /> },
          { path: "staff", element: <AdminStaffPage /> },
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
]);
