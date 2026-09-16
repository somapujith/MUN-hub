import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SupportPanel } from "@/components/support/support-panel";
import { useSession } from "@/hooks/use-session";
import { queryKeys } from "@/api/query-keys";
import { getUnreadConversationCount } from "@/api/support";

/**
 * Floating support trigger, fixed to the bottom-right of the viewport on
 * every page a STUDENT/ORGANIZER can be on. Opens `SupportPanel` inside a
 * `Sheet` (`variant="popover"`) rather than owning any chat logic itself.
 *
 * Fully self-contained: no props. Reads its own session and renders `null`
 * for signed-out users and for OPERATIONS/ADMIN/SUPER_ADMIN, who have their
 * own `/admin/support` queue.
 *
 * Mounted from `components/layout/site-header.tsx` (marketing/dashboard
 * pages) and `components/organizer/workspace-shell.tsx` (the organizer
 * workspace, which doesn't render `SiteHeader`).
 */
const UNREAD_POLL_MS = 25_000;

export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const { data: session } = useSession();

  const eligible = session?.role === "STUDENT" || session?.role === "ORGANIZER";

  const unreadQuery = useQuery({
    queryKey: queryKeys.unreadConversationCount(),
    queryFn: getUnreadConversationCount,
    refetchInterval: UNREAD_POLL_MS,
    enabled: eligible,
  });

  if (!eligible) return null;

  const inboxHref = session.role === "STUDENT" ? "/dashboard/support" : "/organizer/support";
  const unreadCount = unreadQuery.data?.count ?? 0;
  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            size="icon"
            className="fixed right-6 bottom-6 z-50 shadow-lg"
            aria-label="Open support chat"
          />
        }
      >
        <MessageCircleIcon aria-hidden />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] leading-none font-medium text-destructive-foreground"
            aria-hidden
          >
            {badgeLabel}
          </span>
        )}
        <span className="sr-only">
          {unreadCount > 0 ? `Open support chat (${unreadCount} unread)` : "Open support chat"}
        </span>
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          <SheetTitle>Support</SheetTitle>
          <Link
            to={inboxHref}
            className="text-body-sm text-muted-foreground underline-offset-4 hover:text-ink hover:underline"
          >
            Open full inbox
          </Link>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 px-lg pb-lg">
          <SupportPanel variant="popover" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
