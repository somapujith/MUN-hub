import { Navigate, useParams } from "react-router";
import { munSectionHref } from "@/lib/organizer/nav-config";

export function MunIndexRedirect() {
  const { munId = "" } = useParams();
  return <Navigate to={munSectionHref(munId, "setup")} replace />;
}
