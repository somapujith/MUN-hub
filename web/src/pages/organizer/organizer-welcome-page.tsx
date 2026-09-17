import { Helmet } from "react-helmet-async";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { getOrganizerOnboarding } from "@/api/organizer-onboarding";
import { queryKeys } from "@/api/query-keys";
import { ORGANIZER_ACCENT, OrganizerBrightShell } from "@/components/organizer/organizer-bright-shell";
import { RequireOrganizer } from "@/guards/require-organizer";

const STEPS = [
  {
    title: "Register as an organizer",
    description: "Add your profile, PAN, GST and UPI payout details once. It takes a few minutes.",
  },
  {
    title: "Build your MUN",
    description: "Tell us about your conference, then set up committees, portfolios, registration tiers and pricing.",
  },
  {
    title: "Go live on MUN Hub",
    description: "Submit your MUN for review and publish it in front of delegates across the country.",
  },
] as const;

/**
 * Where a newly created organizer account lands (publish.munhub.in): a
 * three-step outline of hosting on MUN Hub and one call to action — the
 * onboarding wizard, or the host application once onboarding is done.
 */
export function OrganizerWelcomePage() {
  return (
    <RequireOrganizer>
      <Helmet>
        <title>Welcome | MUN Hub for organizers</title>
      </Helmet>
      <OrganizerBrightShell>
        <WelcomeContent />
      </OrganizerBrightShell>
    </RequireOrganizer>
  );
}

function WelcomeContent() {
  const onboarding = useQuery({ queryKey: queryKeys.organizerOnboarding(), queryFn: getOrganizerOnboarding });
  const nextHref = onboarding.data?.completed ? "/organizer/apply" : "/organizer/onboarding";

  return (
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
                  style={{ color: ORGANIZER_ACCENT }}
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
            to={nextHref}
            className="mt-xl ml-[100px] inline-flex h-11 items-center gap-1 rounded-lg bg-[#121212] pr-3 pl-4 text-[14px] font-medium text-white transition-colors hover:bg-[#2a2a2e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#121212] md:ml-[112px]"
          >
            {onboarding.data?.completed ? "Apply to host a MUN" : "Start your journey"}
            <ChevronRightIcon aria-hidden className="size-4" strokeWidth={2.5} />
          </Link>
        </div>
      </div>
    </main>
  );
}
