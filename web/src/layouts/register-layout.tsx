import { Outlet } from "react-router";
import { RequireAuth } from "@/guards/require-auth";

/** Registration funnel — UX auth gate; server is authoritative. */
export function RegisterLayout() {
  return (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  );
}
