import { useSession } from "@/hooks/use-session";
import type { StaffRole } from "@/types/admin-staff";
import type { Role } from "@/types/enums";

export const STAFF_ROLES: StaffRole[] = ["OPERATIONS", "ADMIN", "SUPER_ADMIN"];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  OPERATIONS: "Operations",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super admin",
};

/**
 * What the signed-in staff member may do in the admin console. UX only: the
 * server enforces every one of these, so hiding a control never replaces the
 * server check.
 *
 * - OPERATIONS reviews (Gate 1 applications, Gate 2 content and modules) but
 *   never changes what is public: no publish/unpublish/suspend/reinstate,
 *   no queueing, no payment-account verification, no lifecycle moves.
 * - ADMIN and SUPER_ADMIN can do all of that, plus module requirement toggles.
 * - Only SUPER_ADMIN manages staff accounts.
 */
export interface AdminPermissions {
  role: Role | null;
  canPublish: boolean;
  canManageStaff: boolean;
}

export function adminPermissionsFor(role: Role | null | undefined): AdminPermissions {
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  return {
    role: role ?? null,
    canPublish: isAdmin,
    canManageStaff: role === "SUPER_ADMIN",
  };
}

export function useAdminPermissions(): AdminPermissions & { userId: string | null } {
  const { data: session } = useSession();
  return { ...adminPermissionsFor(session?.role), userId: session?.userId ?? null };
}
