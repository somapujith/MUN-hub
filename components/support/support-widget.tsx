"use client";

import * as React from "react";
import Link from "next/link";
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
import { getUnreadConversationCountAction } from "@/app/support/chat-actions";

/**
 * Floating support trigger, fixed to the bottom-right of the viewport on
 * every page a STUDENT/ORGANIZER can be on. Opens `SupportPanel` inside a
 * `Sheet` (`variant="popover"`) rather than owning any chat logic itself.
 *
 * Mounted from `components/layout/site-header.tsx` (marketing/dashboard
 * pages) and `components/organizer/workspace-shell.tsx` (the organizer
 * workspace, which doesn't render `SiteHeader`) — never for
 * OPERATIONS/ADMIN/SUPER_ADMIN, who have their own `/admin/support` queue.
 */
export interface SupportWidgetProps {
  role: "STUDENT" | "ORGANIZER";
  inboxHref: string;
}

const UNREAD_POLL_MS = 25_000;

export function SupportWidget({ role, inboxHref }: SupportWidgetProps) {
  const [open, setOpen] = React.useState(false);
  const [unreadCount, setUnreadCount] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const result = await getUnreadConversationCountAction();
      if (!cancelled && result.ok) {
        setUnreadCount(result.data);
      }
    }

    void refresh();
    const interval = setInterval(refresh, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

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
          <Link href={inboxHref} className="text-body-sm text-muted-foreground underline-offset-4 hover:text-ink hover:underline">
            Open full inbox
          </Link>
        </SheetHeader>

        <div className="min-h-0 flex-1 px-lg pb-lg">
          <SupportPanel role={role} variant="popover" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
