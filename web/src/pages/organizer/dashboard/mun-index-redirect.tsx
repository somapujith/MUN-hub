import { Navigate, useParams } from "react-router";
import { munSectionHref } from "@/lib/organizer/nav-config";
import { useOrganizerWorkspaceMuns } from "@/layouts/workspace-layout";

// Mirrors setup-page.tsx's SUBMITTABLE_STATUSES — before a mun has been
// submitted (or sent back for changes), the index route lands on Quick Setup
// so the minimum-required-fields form is what the organizer sees first.
const PRE_SUBMISSION_STATUSES = new Set(["ONBOARDING", "ACTION_REQUIRED", "READY_FOR_SUBMISSION", "CONTENT_SUBMITTED"]);

export function MunIndexRedirect() {
  const { munId = "" } = useParams();
  const workspace = useOrganizerWorkspaceMuns();
  const status = workspace.data?.muns.find((mun) => mun.id === munId)?.status;
  const segment = status && PRE_SUBMISSION_STATUSES.has(status) ? "quick-setup" : "setup";
  return <Navigate to={munSectionHref(munId, segment)} replace />;
}
