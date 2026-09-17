import { Helmet } from "react-helmet-async";
import { Link } from "react-router";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { RequireOrganizer } from "@/guards/require-organizer";
import { BRIGHT_PRIMARY_BUTTON_CLASS } from "@/components/organizer/bright-form";
import { OrganizerBrightShell } from "@/components/organizer/organizer-bright-shell";

const NEXT_STEPS = [
  "MUN Hub reviews your application, usually within 2 business days.",
  "We email you the decision. If we need anything else, the note shows up on your dashboard.",
  "Once approved, you set up your MUN (dates, committees, passes, documents) and submit it for review.",
];

/**
 * After an organizer applies to host a MUN (from the onboarding wizard or
 * "Host another MUN"). Stays inside the organizer experience: the delegate
 * marketplace is a different product for this visitor.
 */
export function OrganizerApplySubmittedPage() {
  return (
    <RequireOrganizer>
      <Helmet title="Application submitted" />
      <OrganizerBrightShell menuOpenOnDesktop={false}>
        <main className="flex flex-1 items-start px-lg pt-xl pb-28 md:items-center md:pt-section">
          <div className="mx-auto flex w-full max-w-[560px] flex-col items-start gap-lg">
            <span
              aria-hidden
              className="flex size-12 items-center justify-center rounded-full bg-[#e6f6ec] text-[#1f8a4c]"
            >
              <CheckIcon strokeWidth={2} className="size-6" />
            </span>
            <div className="flex flex-col gap-xs">
              <h1 className="text-[30px] leading-tight font-bold tracking-[-0.03em] text-[#121212] md:text-[34px]">
                Application submitted
              </h1>
              <p className="text-[15px] text-[#5b5b63]">
                Thanks. Your MUN is in our review queue. Here&apos;s what happens next:
              </p>
            </div>
            <ol className="flex flex-col gap-sm">
              {NEXT_STEPS.map((step, index) => (
                <li key={step} className="flex items-start gap-sm text-[15px] text-[#121212]">
                  <span
                    aria-hidden
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#f1f1f4] text-[13px] font-semibold text-[#5b5b63]"
                  >
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <Link to="/organizer/dashboard" className={`${BRIGHT_PRIMARY_BUTTON_CLASS} gap-xs`}>
              Go to dashboard
              <ArrowRightIcon aria-hidden strokeWidth={1.75} className="size-4" />
            </Link>
          </div>
        </main>
      </OrganizerBrightShell>
    </RequireOrganizer>
  );
}
