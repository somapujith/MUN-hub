import { Link, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboardIcon,
  LogOutIcon,
  TicketIcon,
  UserRoundIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { signOut } from "@/api/auth";
import { homeUrlForRole, isCrossOrigin, resolveZoneUrl } from "@/lib/host-routing";
import type { Role } from "@/types/enums";

/**
 * Signed-in cluster for `top-nav`. The trigger is `button-icon-circular`
 * (40 × 40, {rounded.full}, hairline border) per the doc's icon-button spec —
 * avatars are the one place {rounded.full} is sanctioned outside icon buttons.
 *
 * `GET /auth/session` returns only `{ userId, role }` — no display name — so
 * the menu labels by role rather than inventing a name lookup.
 */

const ROLE_LABEL: Record<Role, string> = {
  STUDENT: "Delegate",
  ORGANIZER: "Organizer",
  OPERATIONS: "Operations",
  ADMIN: "Admin",
  SUPER_ADMIN: "Admin",
};

interface SiteHeaderUserMenuProps {
  role: Role;
}

/**
 * Dashboard/profile destinations can live on a different origin than the page
 * you're currently on (organize.munhub.in vs munhub.in), and React Router
 * cannot navigate across origins — a `<Link>` there would 404 into whichever
 * SPA is already loaded. So each item picks `<a href>` or `<Link to>` based on
 * whether the resolved URL crossed an origin boundary.
 */
function MenuNavItem({
  url,
  icon,
  children,
}: {
  url: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  if (isCrossOrigin(url)) {
    return (
      <DropdownMenuItem render={<a href={url} />}>
        {icon}
        {children}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem render={<Link to={url} />}>
      {icon}
      {children}
    </DropdownMenuItem>
  );
}

export function SiteHeaderUserMenu({ role }: SiteHeaderUserMenuProps) {
  const label = ROLE_LABEL[role];
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOutMutation = useMutation({
    mutationFn: signOut,
    // Clear regardless of outcome: if the request failed the cookie may still
    // be gone server-side, and leaving a stale "signed in" header behind is
    // worse than optimistically showing signed-out.
    onSettled: () => {
      queryClient.clear();
      navigate("/");
    },
  });

  const dashboardUrl = homeUrlForRole(role);
  const profileUrl = resolveZoneUrl("student", "/profile");
  const registrationsUrl = resolveZoneUrl("student", "/dashboard");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`Account menu (${label})`}
          >
            <span className="text-[13px] font-medium">{label.charAt(0)}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={8} className="w-56!">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Signed in as {label}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <MenuNavItem url={dashboardUrl} icon={<LayoutDashboardIcon />}>
            Dashboard
          </MenuNavItem>
          {role === "STUDENT" && (
            <>
              <MenuNavItem url={registrationsUrl} icon={<TicketIcon />}>
                My registrations
              </MenuNavItem>
              <MenuNavItem url={profileUrl} icon={<UserRoundIcon />}>
                Profile &amp; account
              </MenuNavItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="w-full"
            disabled={signOutMutation.isPending}
            onClick={() => signOutMutation.mutate()}
            nativeButton
            render={<button type="button" />}
          >
            <LogOutIcon />
            {signOutMutation.isPending ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
