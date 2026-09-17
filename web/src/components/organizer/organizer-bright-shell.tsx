import * as React from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOutIcon, MenuIcon, MessageSquareIcon } from "lucide-react";
import { getAccountSettings } from "@/api/account";
import { signOut } from "@/api/auth";
import { queryKeys } from "@/api/query-keys";
import { cn } from "cn";

/** Accent for the bright organizer pages (step numbers, support bubble). */
export const ORGANIZER_ACCENT = "#6d4aff";

function isDesktop(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
}

/**
 * The frame for publish.munhub.in's onboarding pages (welcome, onboarding
 * wizard): a top bar with the menu toggle and wordmark, a left rail with the
 * signed-in account and sign-out, and a support chat bubble.
 *
 * Always the bright theme, whatever the site-wide theme is: it uses fixed
 * colors instead of the theme tokens, which flip in dark mode. Children
 * should do the same.
 */
export function OrganizerBrightShell({
  children,
  menuOpenOnDesktop = true,
}: {
  children: ReactNode;
  /** Whether the left rail starts open on wide screens. It always starts closed on phones. */
  menuOpenOnDesktop?: boolean;
}) {
  const [menuOpen, setMenuOpen] = React.useState(() => menuOpenOnDesktop && isDesktop());

  return (
    <div className="flex min-h-dvh flex-col bg-[#f8f8fa] text-[#121212] [color-scheme:light]">
      <header className="sticky top-0 z-30 flex h-[50px] shrink-0 items-center gap-md border-b border-[#ececf1] bg-white px-md shadow-[0_1px_6px_rgba(18,18,18,0.04)]">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="organizer-shell-menu"
          className="flex size-9 items-center justify-center rounded-md text-[#121212] hover:bg-[#f2f2f5] focus-visible:outline-2 focus-visible:outline-[#121212]"
        >
          <MenuIcon aria-hidden className="size-5" strokeWidth={2.25} />
        </button>
        <Link to="/organizer/welcome" className="flex flex-col leading-none text-[#121212]">
          <span className="flex items-center gap-1.5 text-[20px] font-extrabold tracking-[-0.03em]">
            <span aria-hidden className="size-2 rounded-full bg-[#aa2d00]" />
            MUN Hub
          </span>
          <span className="mt-0.5 pl-3.5 text-[8px] font-bold tracking-[0.18em]">FOR ORGANIZERS</span>
        </Link>
      </header>

      <div className="relative flex flex-1">
        <ShellMenu open={menuOpen} />
        {menuOpen ? (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 top-[50px] z-10 bg-[#121212]/30 lg:hidden"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>

      <Link
        to="/organizer/support"
        aria-label="Chat with MUN Hub support"
        className="fixed right-5 bottom-5 z-30 flex size-14 items-center justify-center rounded-full text-white shadow-[0_6px_20px_rgba(109,74,255,0.35)] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#121212]"
        style={{ backgroundColor: ORGANIZER_ACCENT }}
      >
        <MessageSquareIcon aria-hidden className="size-6" />
      </Link>
    </div>
  );
}

/** The left rail: who's signed in, and sign-out. An overlay below `lg`. */
function ShellMenu({ open }: { open: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const account = useQuery({ queryKey: queryKeys.account(), queryFn: getAccountSettings });

  const signOutMutation = useMutation({
    mutationFn: signOut,
    // Clear regardless of outcome — a stale "signed in" state is worse than an
    // optimistic signed-out one.
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session(), null);
      navigate("/organizer/login", { replace: true });
    },
  });

  return (
    <aside
      id="organizer-shell-menu"
      hidden={!open}
      className={cn(
        "z-20 w-[240px] shrink-0 flex-col justify-end border-r border-[#ececf1] bg-white p-5",
        "max-lg:fixed max-lg:top-[50px] max-lg:bottom-0 max-lg:left-0 max-lg:shadow-[4px_0_16px_rgba(18,18,18,0.08)]",
        open ? "flex" : "hidden",
      )}
    >
      <div className="flex items-end justify-between gap-sm">
        <div className="min-w-0">
          <p className="text-[11px] text-[#77777e]">Signed in with</p>
          <p className="truncate text-[13px] text-[#121212]" title={account.data?.email}>
            {account.data?.email ?? " "}
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOutMutation.mutate()}
          disabled={signOutMutation.isPending}
          aria-label="Sign out"
          title="Sign out"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-[#121212] hover:bg-[#f2f2f5] focus-visible:outline-2 focus-visible:outline-[#121212] disabled:opacity-50"
        >
          <LogOutIcon aria-hidden className="size-5" />
        </button>
      </div>
    </aside>
  );
}
