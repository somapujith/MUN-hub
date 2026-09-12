"use client";

import Link from "next/link";
import { LayoutDashboardIcon, LogOutIcon, TicketIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/actions/session";
import type { Role } from "@/lib/db/schema-enums";

/**
 * Signed-in cluster for `top-nav`. The trigger is `button-icon-circular`
 * (40 × 40, {rounded.full}, hairline border) per the doc's icon-button spec —
 * avatars are the one place {rounded.full} is sanctioned outside icon buttons.
 *
 * `getSession()` (frozen contract) returns only `{ userId, role }` — no display
 * name — so the menu labels by role rather than inventing a name lookup.
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
  dashboardHref: string;
}

export function SiteHeaderUserMenu({
  role,
  dashboardHref,
}: SiteHeaderUserMenuProps) {
  const label = ROLE_LABEL[role];

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
        <DropdownMenuLabel>Signed in as {label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={dashboardHref} />}>
          <LayoutDashboardIcon />
          Dashboard
        </DropdownMenuItem>
        {role === "STUDENT" && (
          <DropdownMenuItem render={<Link href="/dashboard" />}>
            <TicketIcon />
            My registrations
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem
            variant="destructive"
            className="w-full"
            render={<button type="submit" />}
            nativeButton
          >
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
