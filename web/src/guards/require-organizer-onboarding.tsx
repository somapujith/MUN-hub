import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getOrganizerOnboarding } from "@/api/organizer-onboarding";
import { queryKeys } from "@/api/query-keys";

/**
 * Sends an organizer who hasn't finished onboarding (profile, PAN, GST, UPI,
 * agreement) to the wizard. Use inside `RequireOrganizer`. UX only — the API
 * refuses host applications until onboarding is complete regardless.
 */
export function RequireOrganizerOnboarding({ children }: { children: ReactNode }) {
  const onboarding = useQuery({ queryKey: queryKeys.organizerOnboarding(), queryFn: getOrganizerOnboarding });

  if (onboarding.isPending) return null;
  if (onboarding.data && !onboarding.data.completed) {
    return <Navigate to="/organizer/onboarding" replace />;
  }
  return children;
}
