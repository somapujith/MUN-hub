import * as React from "react";
import { Link } from "react-router";
import type { LucideIcon } from "lucide-react";
import {
  BuildingIcon,
  FlagIcon,
  HandshakeIcon,
  LockIcon,
  ReceiptIcon,
  TicketIcon,
} from "lucide-react";
import { InfoPageShell, InfoSection, PageHero } from "@/components/content/info-page";
import { RegisteredBusinessDetails } from "@/components/content/registered-business-details";
import { Button } from "@/components/ui/button";
import { useListYourMunHref } from "@/hooks/use-list-your-mun-href";
import { SITE_INFO, mailto } from "@/lib/site-info";

type ContactChannel = {
  id: string;
  icon: LucideIcon;
  audience: string;
  title: string;
  body: React.ReactNode;
  primary: { label: string; to: string };
  secondary?: { label: string; to: string };
  email?: string;
  /**
   * An organizer-registration entry point: its primary link comes from
   * `useListYourMunHref`, and the whole card is hidden when that returns null
   * (signed-in delegates and staff never see one).
   */
  listsYourMun?: true;
};

const CHANNELS: ContactChannel[] = [
  {
    id: "registrations",
    icon: TicketIcon,
    audience: "Delegates",
    title: "Registrations and payments",
    body: "A missing confirmation, a payment that didn't go through, a seat hold that expired, or a charge that looks wrong. Sign in and open a ticket, and we'll follow up by email.",
    primary: { label: "Open a support ticket", to: "/support/new" },
    secondary: { label: "View my registrations", to: "/dashboard" },
    email: SITE_INFO.emails.support,
  },
  {
    id: "list-your-mun",
    icon: BuildingIcon,
    audience: "Organizers",
    title: "List your conference",
    body: "Run a MUN and want it on the marketplace? Create an organizer account and apply. We'll review your organization and guide you through setting up your listing.",
    primary: { label: "List your MUN", to: "/organizer/signup" },
    secondary: { label: "How review works", to: "/about/curation#review-process" },
    email: SITE_INFO.emails.organizers,
    listsYourMun: true,
  },
  {
    id: "organizer-support",
    icon: ReceiptIcon,
    audience: "Existing organizers",
    title: "Help with your workspace",
    body: "Questions about your listing, a review decision, payouts, or delegate management. Message our team from inside your organizer account.",
    primary: { label: "Organizer support", to: "/organizer/support" },
    secondary: { label: "Organizer sign in", to: "/organizer/login" },
    email: SITE_INFO.emails.organizers,
  },
  {
    id: "report",
    icon: FlagIcon,
    audience: "Anyone",
    title: "Report a listing or a safety concern",
    body: "Details that don't match, an organizer who doesn't seem official, or anything that puts delegates at risk. Choose “Safety / policy” when you open a ticket.",
    primary: { label: "Report a concern", to: "/support/new" },
    secondary: { label: "Our curation standards", to: "/about/curation" },
    email: SITE_INFO.emails.support,
  },
  {
    id: "privacy",
    icon: LockIcon,
    audience: "Anyone",
    title: "Privacy and data requests",
    body: "Ask for a copy of your data, a correction, or deletion, or raise a complaint with our Grievance Officer.",
    primary: { label: "Read the Privacy policy", to: "/legal/privacy" },
    email: SITE_INFO.emails.privacy,
  },
  {
    id: "partnerships",
    icon: HandshakeIcon,
    audience: "Everyone else",
    title: "Partnerships and press",
    body: "Schools, universities, MUN circuits, sponsors, and journalists are welcome to write to us.",
    primary: { label: "About MUN Hub", to: "/about" },
    email: SITE_INFO.emails.hello,
  },
];

const QUICK_ANSWERS = [
  {
    question: "I paid, but my registration still says payment pending.",
    answer: (
      <>
        We confirm a registration once we've verified the payment, which
        usually takes a few minutes. If it still says pending after that,
        open a ticket with the conference name and we'll check it for you.
      </>
    ),
  },
  {
    question: "My seat hold expired while I was paying.",
    answer: (
      <>
        A seat is held for 15 minutes. If money left your account after the
        hold expired, no registration was created, so we return the full
        amount. See{" "}
        <Link to="/legal/refunds#failed-and-late-payments">payment errors</Link>.
      </>
    ),
  },
  {
    question: "Can I get a refund if I can't attend?",
    answer: (
      <>
        No. Once a registration is paid and confirmed, it's final, even if
        your plans change or the conference changes. Please check the details
        before you pay. See our <Link to="/legal/refunds">Refund policy</Link>.
      </>
    ),
  },
  {
    question: "I have a question about a committee, agenda, or the conference schedule.",
    answer: (
      <>
        Start with the conference page, which lists its committees and
        passes. If it doesn't answer your question, open a ticket under “MUN
        info” and we'll help you get an answer from the organizer.
      </>
    ),
  },
  {
    question: "I forgot my password.",
    answer: (
      <>
        Reset it from the <Link to="/forgot-password">forgot password</Link>{" "}
        page. We'll email you a link that works for one hour.
      </>
    ),
  },
];

export function ContactPage() {
  const listYourMunHref = useListYourMunHref();
  const channels = CHANNELS.flatMap((channel) => {
    if (!channel.listsYourMun) return [channel];
    return listYourMunHref
      ? [{ ...channel, primary: { ...channel.primary, to: listYourMunHref } }]
      : [];
  });

  return (
    <InfoPageShell
      title="Contact"
      description="Get help with a MUN Hub registration or payment, list your Model UN conference, report a listing, or make a privacy request."
    >
      <PageHero
        eyebrow="Contact"
        title="How can we help?"
        lede="Choose what you need below, and we'll get your question to the right people. Signed-in tickets are the fastest route, because we can see which account you're asking about."
      />

      <div className="content-container flex flex-col gap-section py-xxl md:py-section">
        <ul className="grid gap-lg md:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => (
            <li key={channel.id} id={channel.id} className="scroll-mt-24">
              <ChannelCard channel={channel} />
            </li>
          ))}
        </ul>

        <InfoSection
          eyebrow="Before you write in"
          title="Quick answers"
          intro="Some questions we can answer right here."
        >
          <dl className="grid max-w-5xl gap-x-xl gap-y-lg md:grid-cols-2">
            {QUICK_ANSWERS.map((item) => (
              <div key={item.question} className="border-t border-border pt-md">
                <dt className="font-display text-title-sm font-medium text-ink">{item.question}</dt>
                <dd className="mt-xs text-base leading-7 text-body dark:text-muted-foreground [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4">
                  {item.answer}
                </dd>
              </div>
            ))}
          </dl>
        </InfoSection>

        <InfoSection eyebrow="Registered business" title="Write to us directly" id="registered-business">
          <RegisteredBusinessDetails />
        </InfoSection>

        <InfoSection
          eyebrow="Good to know"
          title="MUN Hub doesn't run the conferences we list"
          intro={
            <>
              Each conference is organized and delivered by its own
              secretariat. We handle discovery, registration, payments, and
              review of every listing. Questions about what happens at the
              conference itself are best sent to the organizer. See our{" "}
              <Link to="/legal/terms" className="text-link underline underline-offset-4">
                Terms of service
              </Link>{" "}
              for how responsibilities are split.
            </>
          }
        />
      </div>
    </InfoPageShell>
  );
}

function ChannelCard({ channel }: { channel: ContactChannel }) {
  const { icon: Icon } = channel;
  return (
    <article className="flex h-full flex-col gap-sm rounded-lg border border-border p-lg">
      <div className="flex items-center gap-sm">
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-md bg-surface-soft text-ink"
        >
          <Icon className="size-5" />
        </span>
        <p className="text-caption uppercase tracking-[0.16px] text-muted-foreground">
          {channel.audience}
        </p>
      </div>
      <h2 className="font-display text-title-md font-normal text-ink">{channel.title}</h2>
      <p className="text-body-md leading-relaxed text-body dark:text-muted-foreground">{channel.body}</p>

      <div className="mt-auto flex flex-col gap-sm pt-sm">
        <div className="flex flex-wrap gap-xs">
          <Button size="sm" render={<Link to={channel.primary.to} />}>
            {channel.primary.label}
          </Button>
          {channel.secondary ? (
            <Button size="sm" variant="outline" render={<Link to={channel.secondary.to} />}>
              {channel.secondary.label}
            </Button>
          ) : null}
        </div>
        {channel.email ? (
          <p className="text-body-md text-muted-foreground">
            Or email{" "}
            <a
              href={mailto(channel.email)}
              className="rounded-sm text-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {channel.email}
            </a>
          </p>
        ) : null}
      </div>
    </article>
  );
}
