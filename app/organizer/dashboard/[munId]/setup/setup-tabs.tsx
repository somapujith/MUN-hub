"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarRangeIcon,
  ImageIcon,
  ListOrderedIcon,
  MailIcon,
  ScaleIcon,
  SettingsIcon,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ModulePlaceholder } from "@/components/organizer/module-placeholder";

/**
 * The PRD § 9–11 sub-sections as a tab strip.
 *
 * Per `../../nav-config.ts`: these are NOT sidebar entries (the sidebar would
 * hit 24 items), they live inside `/[munId]/setup` and this module owns the
 * `?tab=` search param.
 *
 * WHY THE PARAM AT ALL
 * --------------------
 * Local `useState` would be less code, but it makes the active tab
 * unlinkable, unbookmarkable, and lost on back/forward. A settings surface is
 * exactly where someone pastes a colleague "the venue fields are here". The
 * param is written with `replace` + `scroll: false` so tab switching doesn't
 * pile up history entries or jump the viewport.
 *
 * The panels themselves are passed in as props from the server page rather
 * than imported here, because the two real ones need mun data this client
 * component has no business fetching.
 */

interface SetupTab {
  value: string;
  label: string;
  icon: typeof SettingsIcon;
}

const TABS: readonly SetupTab[] = [
  { value: "general", label: "General", icon: SettingsIcon },
  { value: "dates-venue", label: "Dates & venue", icon: CalendarRangeIcon },
  { value: "branding", label: "Branding", icon: ImageIcon },
  { value: "schedule", label: "Schedule", icon: ListOrderedIcon },
  { value: "rules", label: "Rules", icon: ScaleIcon },
  { value: "faqs", label: "FAQs", icon: ListOrderedIcon },
  { value: "contact", label: "Contact", icon: MailIcon },
];

const DEFAULT_TAB = "general";

/**
 * Copy for the five stub tabs.
 *
 * These are stubs for one concrete reason, not for scheduling reasons: there
 * are no columns behind them. `muns` (lib/db/schema.ts) carries name, edition,
 * theme, description, startDate, endDate, venue, city, country and nothing
 * else — no logo, no cover image, no gallery, no sponsor logos, no schedule
 * rows, no rules body, no FAQ list, no contact fields. Shipping a form that
 * looks like it saves and then throws the input away would be worse than an
 * honest placeholder, so each one says what it's waiting on.
 */
const STUB_COPY: Record<string, { icon: typeof SettingsIcon; description: string }> = {
  branding: {
    icon: ImageIcon,
    description:
      "Logo, cover image, gallery and sponsor logos will be uploaded here. File uploads aren't supported yet — the conference record has no image fields and no storage bucket is wired up, so there's nowhere for an upload to land.",
  },
  schedule: {
    icon: ListOrderedIcon,
    description:
      "The day-by-day session schedule will be built here. The conference record has no schedule fields yet, so there's nothing to save against.",
  },
  rules: {
    icon: ScaleIcon,
    description:
      "Rules of procedure and conference policies will be authored here. The conference record has no rules fields yet, so there's nothing to save against.",
  },
  faqs: {
    icon: ListOrderedIcon,
    description:
      "Frequently asked questions will be managed here as a reorderable list. The conference record has no FAQ fields yet, so there's nothing to save against.",
  },
  contact: {
    icon: MailIcon,
    description:
      "Public contact details and enquiry routing will be configured here. The conference record has no contact fields yet, so there's nothing to save against.",
  },
};

export function SetupTabs({
  generalPanel,
  datesVenuePanel,
}: {
  generalPanel: React.ReactNode;
  datesVenuePanel: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = searchParams.get("tab");
  // An unknown `?tab=` value falls back to General rather than rendering an
  // empty Tabs root with no active panel.
  const active = TABS.some((tab) => tab.value === requested) ? requested! : DEFAULT_TAB;

  const handleChange = React.useCallback(
    (value: unknown) => {
      const next = String(value);
      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_TAB) params.delete("tab");
      else params.set("tab", next);

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const panels: Record<string, React.ReactNode> = {
    general: generalPanel,
    "dates-venue": datesVenuePanel,
  };

  return (
    <Tabs value={active} onValueChange={handleChange} className="gap-xl">
      {/* Horizontally scrollable at narrow widths: seven tabs will not fit on a
          phone, and wrapping them to two rows would detach the underline rule
          from the panel below it. */}
      <div className="-mx-md overflow-x-auto px-md sm:-mx-lg sm:px-lg xl:mx-0 xl:px-0">
        <TabsList variant="line" aria-label="MUN setup sections">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon aria-hidden strokeWidth={1.75} />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {TABS.map(({ value }) => {
        const stub = STUB_COPY[value];
        return (
          <TabsContent key={value} value={value}>
            {stub ? (
              <ModulePlaceholder icon={stub.icon} description={stub.description} />
            ) : (
              panels[value]
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
