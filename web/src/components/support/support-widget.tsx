import { useState } from "react";
import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SupportPanel } from "@/components/support/support-panel";
import { ZoneLink } from "@/components/support/zone-link";
import { inboxUrlForRole } from "@/components/support/support-labels";
import { SUPPORT_POLL_MS } from "@/components/support/use-support";
import { useSession } from "@/hooks/use-session";
import { queryKeys } from "@/api/query-keys";
import { getUnreadConversationCount } from "@/api/support";
import { loginPathFor, resolveZoneUrl } from "@/lib/host-routing";
import { SITE_INFO, mailto } from "@/lib/site-info";

const REQUESTER_ROLES = new Set(["STUDENT", "ORGANIZER"]);

/** Pages that already are the support inbox (or the staff console) don't need the bubble. */
function hiddenOn(pathname: string): boolean {
  return (
    pathname === "/dashboard/support" ||
    pathname === "/organizer/support" ||
    pathname === "/support/new" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
}

/**
 * Floating support chat, bottom-right on the pages delegates and organizers
 * use. Signed-in delegates and organizers get their conversations
 * (`SupportPanel`); signed-out visitors get a sign-in prompt; staff get
 * nothing (they work from /admin/support). Mounted by the site header and the
 * organizer workspace shell.
 *
 * Only the unread badge polls while the sheet is closed, slowly, and only
 * while the tab is visible; the list and thread poll only while open.
 */
export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const { data: session, isPending } = useSession();
  const location = useLocation();

  const requester = Boolean(session && REQUESTER_ROLES.has(session.role));
  const hidden = hiddenOn(location.pathname) || isPending || (session !== null && session !== undefined && !requester);

  const unreadQuery = useQuery({
    queryKey: queryKeys.unreadConversationCount(),
    queryFn: getUnreadConversationCount,
    enabled: requester && !hidden,
    refetchInterval: open ? false : SUPPORT_POLL_MS.badge,
    refetchIntervalInBackground: false,
  });

  if (hidden) return null;

  const unreadCount = requester ? (unreadQuery.data?.count ?? 0) : 0;
  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);
  const inboxUrl = session ? inboxUrlForRole(session.role) : null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            size="icon-lg"
            className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 shadow-lg sm:right-6 sm:bottom-6"
            aria-label={unreadCount > 0 ? `Open support chat (${unreadCount} unread)` : "Open support chat"}
          />
        }
      >
        <MessageCircleIcon aria-hidden className="size-5" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] leading-none font-medium text-white"
            aria-hidden
          >
            {badgeLabel}
          </span>
        )}
      </SheetTrigger>

      <SheetContent className="gap-0 sm:max-w-md">
        <SheetHeader className="gap-xxs px-lg py-md pr-xxl">
          <SheetTitle>Support</SheetTitle>
          <SheetDescription className="text-[13px]">
            {requester ? "Chat with the MUN Hub team." : "Questions about a conference, a registration or your account?"}
          </SheetDescription>
          {inboxUrl && (
            <ZoneLink url={inboxUrl} className="w-fit text-[13px] text-link underline-offset-4 hover:underline">
              Open full inbox
            </ZoneLink>
          )}
        </SheetHeader>

        {requester ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <SupportPanel variant="popover" />
          </div>
        ) : (
          <SignedOutPrompt returnTo={`${location.pathname}${location.search}`} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SignedOutPrompt({ returnTo }: { returnTo: string }) {
  const login = `${loginPathFor(returnTo)}?redirectTo=${encodeURIComponent(returnTo)}`;
  const organizerLogin = resolveZoneUrl("organizer", "/organizer/login");

  return (
    <div className="flex flex-col gap-md p-lg">
      <div className="flex flex-col gap-xxs">
        <p className="font-display text-title-sm text-ink">Sign in to chat with us</p>
        <p className="text-body-md text-muted-foreground">
          Support conversations are tied to your account, so we can see your registrations and reply here.
        </p>
      </div>
      <div className="flex flex-wrap gap-xs">
        <Button size="sm" render={<Link to={login} />}>
          Sign in
        </Button>
        <Button size="sm" variant="outline" render={<Link to="/signup" />}>
          Create account
        </Button>
      </div>
      <p className="text-body-md text-muted-foreground">
        Running a conference?{" "}
        <ZoneLink url={organizerLogin} className="text-link underline-offset-4 hover:underline">
          Organizer sign-in
        </ZoneLink>
      </p>
      <p className="text-body-md text-muted-foreground">
        Can&apos;t sign in? Email{" "}
        <a href={mailto(SITE_INFO.emails.support)} className="text-link underline-offset-4 hover:underline">
          {SITE_INFO.emails.support}
        </a>
        .
      </p>
    </div>
  );
}
