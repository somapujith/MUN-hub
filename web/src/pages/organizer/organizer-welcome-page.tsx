import * as React from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, LogOutIcon, MenuIcon, MessageSquareIcon } from "lucide-react";
import { getAccountSettings } from "@/api/account";
import { signOut } from "@/api/auth";
import { queryKeys } from "@/api/query-keys";
import { RequireOrganizer } from "@/guards/require-organizer";
import { cn } from "cn";

// Always the bright theme, whatever the site-wide theme is: this page uses
// fixed colors instead of the theme tokens, which flip in dark mode.
const ACCENT = "#6d4aff";

const STEPS = [
  {
    title: "Apply as an organizer",
    description: "Tell us about your conference. We review every application within 5 business days.",
  },
  {
    title: "Build your MUN",
    description: "Set up committees, portfolios, registration tiers and pricing just the way you want.",
  },
  {
    title: "Go live on MUN Hub",
    description: "Submit your MUN for review and publish it in front of delegates across the country.",
  },
] as const;

function isDesktop(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
}

/**
 * Where a newly created organizer account lands (publish.munhub.in): a
 * three-step outline of hosting on MUN Hub and one call to action, the
 * organizer application.
 */
export function OrganizerWelcomePage() {
  const [menuOpen, setMenuOpen] = React.useState(isDesktop);

  return (
    <RequireOrganizer>
      <Helmet>
        <title>Welcome | MUN Hub for organizers</title>
      </Helmet>
      <div className="flex min-h-dvh flex-col bg-[#f8f8fa] text-[#121212] [color-scheme:light]">
        <header className="sticky top-0 z-30 flex h-[50px] shrink-0 items-center gap-md border-b border-[#ececf1] bg-white px-md shadow-[0_1px_6px_rgba(18,18,18,0.04)]">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="organizer-welcome-menu"
            className="flex size-9 items-center justify-center rounded-md text-[#121212] hover:bg-[#f2f2f5] focus-visible:outline-2 focus-visible:outline-[#121212]"
          >
            <MenuIcon aria-hidden className="size-5" strokeWidth={2.25} />
          </button>
          <Link to="/organizer/welcome" className="flex flex-col leading-none">
            <span className="flex items-center gap-1.5 text-[20px] font-extrabold tracking-[-0.03em]">
              <span aria-hidden className="size-2 rounded-full bg-[#aa2d00]" />
              MUN Hub
            </span>
            <span className="mt-0.5 pl-3.5 text-[8px] font-bold tracking-[0.18em] text-[#121212]">FOR ORGANIZERS</span>
          </Link>
        </header>

        <div className="relative flex flex-1">
          <WelcomeMenu open={menuOpen} />

          {menuOpen ? (
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 top-[50px] z-10 bg-[#121212]/30 lg:hidden"
            />
          ) : null}

          <main className="flex flex-1 items-center justify-center px-lg pt-section pb-28 lg:pb-section">
            <div className="grid w-full max-w-[1040px] items-center gap-xxl lg:grid-cols-[1fr_1fr] lg:gap-section">
              {/* Explicit text colors throughout: the global dark-mode heading
                  styles would otherwise wash these out on the light surface. */}
              <h1 className="text-[32px] leading-[1.2] font-normal tracking-[-0.025em] text-[#121212] md:text-[40px]">
                <span className="lg:block lg:whitespace-nowrap">Reach the right delegates,</span>{" "}
                <span className="lg:block lg:whitespace-nowrap">grow as you host</span>
              </h1>

              <div>
                <ol className="flex flex-col gap-xl">
                  {STEPS.map((step, index) => (
                    <li key={step.title} className="flex items-start gap-lg">
                      <span
                        aria-hidden
                        className="w-[76px] shrink-0 text-[56px] leading-[0.9] font-extralight tabular-nums md:w-[88px] md:text-[64px]"
                        style={{ color: ACCENT }}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="flex flex-col gap-xs pt-1">
                        <h2 className="text-[20px] leading-tight font-normal tracking-[-0.01em] text-[#121212] md:text-[22px]">
                          <span className="sr-only">Step {index + 1}: </span>
                          {step.title}
                        </h2>
                        <p className="max-w-[380px] text-[15px] leading-[1.5] text-[#77777e]">{step.description}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <Link
                  to="/organizer/apply"
                  className="mt-xl ml-[100px] inline-flex h-11 items-center gap-1 rounded-lg bg-[#121212] pr-3 pl-4 text-[14px] font-medium text-white transition-colors hover:bg-[#2a2a2e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#121212] md:ml-[112px]"
                >
                  Start your journey
                  <ChevronRightIcon aria-hidden className="size-4" strokeWidth={2.5} />
                </Link>
              </div>
            </div>
          </main>
        </div>

        <Link
          to="/organizer/support"
          aria-label="Chat with MUN Hub support"
          className="fixed right-5 bottom-5 z-30 flex size-14 items-center justify-center rounded-full text-white shadow-[0_6px_20px_rgba(109,74,255,0.35)] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#121212]"
          style={{ backgroundColor: ACCENT }}
        >
          <MessageSquareIcon aria-hidden className="size-6" />
        </Link>
      </div>
    </RequireOrganizer>
  );
}

/** The left rail: who's signed in, and sign-out. An overlay below `lg`. */
function WelcomeMenu({ open }: { open: boolean }) {
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
      id="organizer-welcome-menu"
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
