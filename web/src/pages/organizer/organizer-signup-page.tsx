import { Navigate, useLocation } from "react-router";

/**
 * There is no separate organizer signup anymore (see lib/actions/organizer-otp.ts
 * and organizer-login-page.tsx): logging in with an email that has no account
 * yet creates one. This route is kept only so old links/bookmarks still land
 * somewhere — it redirects straight to /organizer/login, preserving any
 * `?redirectTo=` in the query string.
 */
export function OrganizerSignupPage() {
  const location = useLocation();
  return <Navigate to={`/organizer/login${location.search}`} replace />;
}
