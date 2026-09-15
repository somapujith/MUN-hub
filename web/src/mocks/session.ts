import type { Session, UserProfile } from "@/types";

/** Mock organizer — Phase 5 shells only; no real auth. */
export const MOCK_ORGANIZER_SESSION: Session = {
  userId: "user-organizer-1",
  role: "ORGANIZER",
};

/** Mock admin — Phase 6 shells only; no real auth. */
export const MOCK_ADMIN_SESSION: Session = {
  userId: "user-admin-1",
  role: "ADMIN",
};

/** Phase 4 mock student — authenticated read-heavy routes. */
export const MOCK_STUDENT_SESSION: Session = {
  userId: "user-student-mock",
  role: "STUDENT",
};

export const MOCK_USER_PROFILE: UserProfile = {
  name: "Alex Kumar",
  email: "student@munhub.test",
  phone: "+91 98765 43210",
  institution: "VIT Vellore",
};

/** Stub until GET /api/v1/auth/session lands (Task 3.7). */
export async function fetchMockSession(): Promise<Session> {
  await new Promise((r) => setTimeout(r, 80));
  return MOCK_STUDENT_SESSION;
}

export async function fetchMockUserProfile(_userId: string): Promise<UserProfile> {
  await new Promise((r) => setTimeout(r, 60));
  return MOCK_USER_PROFILE;
}

/** UX-only session for guarded route trees (server enforces on API). */
export function getMockSessionForRoute(pathname: string): Session | null {
  if (pathname.startsWith("/admin")) return MOCK_ADMIN_SESSION;
  if (pathname.startsWith("/organizer")) return MOCK_ORGANIZER_SESSION;
  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/support")
  ) {
    return MOCK_STUDENT_SESSION;
  }
  return null;
}
