import { Link } from "react-router";
import { CheckIcon, XIcon } from "lucide-react";
import { InfoPageShell, InfoSection, PageHero, Prose } from "@/components/content/info-page";
import { Button } from "@/components/ui/button";
import {
  SignatureCard,
  SignatureCardActions,
  SignatureCardDescription,
  SignatureCardEyebrow,
  SignatureCardTitle,
} from "@/components/ui/signature-card";

const STAGES = [
  {
    title: "Organizer approval",
    body: "Before anyone can build a listing, we review the organization behind it: who they are, whether they are authorized to run the conference, their previous editions, and whether the venue is credible. We also screen for duplicate or suspicious applications.",
    outcome: "Approved, changes requested, or rejected",
  },
  {
    title: "A complete listing",
    body: "The organizer fills in every required section. When they submit, automated checks flag missing or inconsistent information before a reviewer spends time on it.",
    outcome: "Anything incomplete goes back to the organizer with specific fixes",
  },
  {
    title: "The organizer's final confirmation",
    body: "The organizer reviews a full summary of the listing and formally confirms it is accurate, complete, and authorized for publication. We keep a timestamped record of exactly what they confirmed.",
    outcome: "The organizer is on record as accountable for the content",
  },
  {
    title: "MUN Hub review",
    body: "A member of our team checks the listing section by section and records any issue against the exact section it affects. We aim to finish each review within one business day of submission.",
    outcome: "Verified, changes requested, or rejected",
  },
  {
    title: "Publication",
    body: "Just before a listing goes live, we check it once more against the current data, so nothing that changed in the meantime slips through unreviewed.",
    outcome: "The conference appears in the marketplace",
  },
  {
    title: "Payment verification",
    body: "After launch, each registration is confirmed only when our servers have verified the payment. A success screen in your browser doesn't confirm a registration.",
    outcome: "No seat is confirmed without a verified payment",
  },
];

const CHECKLIST = [
  { title: "Organizer identity", body: "The organization is real, and the person applying may represent it." },
  { title: "Conference name and edition", body: "Accurate, not misleading, and not impersonating another conference." },
  { title: "Dates", body: "Consistent across the listing, the schedule, and registration deadlines." },
  { title: "Venue and city", body: "A real, specific location that matches the conference's plans." },
  { title: "Passes, pricing, and capacity", body: "Clear prices, realistic seat limits, and sensible deadlines." },
  { title: "Committees and agendas", body: "Each committee has a defined agenda and a sensible capacity." },
  { title: "Portfolios", body: "Allocations that match their committees, with no duplicates." },
  { title: "Executive board", body: "The people chairing committees are named for the committees they chair." },
  { title: "Rules, schedule, and documents", body: "Enough information for a delegate to prepare and plan travel." },
  { title: "Contact details", body: "A working way for delegates to reach the secretariat." },
  { title: "Payout account", body: "The account that receives registration fees belongs to the organizer." },
  { title: "Registration terms", body: "Clear eligibility rules and conditions that match our Terms, with no refund promises." },
];

const SEVERITIES = [
  {
    label: "Blocker",
    tone: "bg-destructive/10 text-destructive-text",
    body: "Must be fixed before the listing can be published.",
  },
  {
    label: "High",
    tone: "bg-warning/15 text-warning-text",
    body: "A significant problem with accuracy or compliance.",
  },
  {
    label: "Medium",
    tone: "bg-info/10 text-info-text",
    body: "A correction is required.",
  },
  {
    label: "Low",
    tone: "bg-surface-strong text-ink",
    body: "Cosmetic or wording issue.",
  },
];

// Mirrors lib/lifecycle/reverification.ts#HIGH_IMPACT_FIELDS (plus the
// registration-form exception in lib/actions/registration-form.ts), in plain
// language. Update both together. PAYMENT_SETTLEMENT's `refundPolicy` field is
// deliberately not listed: payments on MUN Hub are non-refundable.
const HIGH_IMPACT_CHANGES = [
  "Conference name or edition",
  "Dates, venue, city, or registration deadline",
  "Passes: their names, availability, prices (including early-bird prices), seat limits, or deadlines",
  "Committee names, agendas, or capacities, and portfolio names or availability",
  "Executive board members and their roles",
  "Schedule timings, rules and documents, and accommodation options",
  "The official contact email or phone number",
  "Payout bank details or payment settings",
  "Removing a registration question, or making an optional question required",
];

export function CurationStandardsPage() {
  return (
    <InfoPageShell
      title="Curation standards"
      description="How MUN Hub reviews every Model UN conference before it goes live: organizer verification, content review, organizer confirmation, and re-review after important changes."
    >
      <PageHero
        eyebrow="Curation standards"
        title="How a conference earns its place on MUN Hub"
        lede="Nothing goes live on MUN Hub without review. This page explains what we check, who is responsible for what, and what happens when details change after launch."
      />

      <div className="content-container flex flex-col gap-section py-xxl md:py-section">
        <InfoSection
          eyebrow="The foundation"
          title="Two kinds of sign-off, on every listing"
          intro="Trustworthy information needs both parties to stand behind it. So every conference carries a confirmation from its organizer and a verification from us."
        >
          <div className="grid max-w-5xl gap-lg md:grid-cols-2">
            <SignOffCard
              who="The organizer confirms"
              quote="This information is accurate and authorized."
              body="The organizer is responsible for the content. They confirm each section and then the complete listing, and we keep a record of each confirmation."
            />
            <SignOffCard
              who="MUN Hub verifies"
              quote="This information passed our review."
              body="Our team is responsible for the review. We check the listing independently and record what we checked, what we found, and what we decided."
            />
          </div>
        </InfoSection>

        <InfoSection
          id="review-process"
          eyebrow="Step by step"
          title="The review process"
          intro="Every conference goes through the same six stages. Nobody can skip one, including returning organizers."
        >
          <ol className="flex max-w-4xl flex-col">
            {STAGES.map((stage, index) => (
              <li
                key={stage.title}
                className="grid gap-sm border-t border-border py-lg last:border-b sm:grid-cols-[56px_minmax(0,1fr)]"
              >
                <span
                  aria-hidden
                  className="flex size-10 items-center justify-center rounded-full bg-ink font-display text-label-md text-background tabular-nums"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-display text-title-md font-normal text-ink">
                    <span className="sr-only">Stage {index + 1}: </span>
                    {stage.title}
                  </h3>
                  <p className="mt-xs max-w-[65ch] text-base leading-7 text-body dark:text-muted-foreground">
                    {stage.body}
                  </p>
                  <p className="mt-sm text-body-md text-muted-foreground">
                    <span className="font-medium text-ink">Outcome:</span> {stage.outcome}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </InfoSection>

        <InfoSection
          id="what-we-check"
          eyebrow="The checklist"
          title="What we check"
          intro="Reviewers work through the same checklist for every conference."
        >
          <ul className="grid gap-x-xl gap-y-md sm:grid-cols-2 lg:grid-cols-3">
            {CHECKLIST.map((item) => (
              <li key={item.title} className="flex gap-sm">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success-text"
                >
                  <CheckIcon className="size-3.5" />
                </span>
                <div>
                  <p className="text-label-md text-ink">{item.title}</p>
                  <p className="mt-xxs text-body-md leading-relaxed text-body dark:text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-xxl max-w-4xl">
            <h3 className="font-display text-title-md font-normal text-ink">
              How we grade issues
            </h3>
            <p className="mt-xs max-w-[62ch] text-base leading-7 text-body dark:text-muted-foreground">
              Each issue we raise names the section it affects, the reason, and
              a severity, so organizers know exactly what to fix first.
            </p>
            <dl className="mt-md grid gap-sm sm:grid-cols-2">
              {SEVERITIES.map((severity) => (
                <div
                  key={severity.label}
                  className="flex items-start gap-sm rounded-md border border-border p-md"
                >
                  <dt
                    className={`shrink-0 rounded-sm px-xs py-xxs text-caption ${severity.tone}`}
                  >
                    {severity.label}
                  </dt>
                  <dd className="text-body-md leading-relaxed text-body dark:text-muted-foreground">
                    {severity.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </InfoSection>

        <InfoSection
          id="after-publication"
          eyebrow="After launch"
          title="When important details change"
          intro="Verification isn't a one-time stamp. If an organizer changes something delegates rely on, the listing goes back through review before the change is published."
        >
          <div className="grid max-w-5xl gap-xl lg:grid-cols-2">
            <div>
              <h3 className="font-display text-title-sm font-medium text-ink">
                Changes that trigger a new review
              </h3>
              <ul className="mt-sm flex list-disc flex-col gap-xs pl-lg text-base leading-7 text-body marker:text-muted-foreground dark:text-muted-foreground">
                {HIGH_IMPACT_CHANGES.map((change) => (
                  <li key={change} className="pl-xxs">
                    {change}
                  </li>
                ))}
              </ul>
            </div>
            <Prose>
              <h3>What delegates should know</h3>
              <p>
                While a live conference is being re-reviewed, it is temporarily
                hidden from the marketplace and new registrations are paused.
                Registrations that are already confirmed are not affected.
              </p>
              <p>
                Payments are final, even if a conference later changes or is
                cancelled (see our <Link to="/legal/refunds">Refund policy</Link>).
                That's why we review changes before they're published.
              </p>
              <h3>What organizers should know</h3>
              <p>
                While a submission is under review, sections that affect
                delegates are locked, so the version we approve is the version
                that goes live. Minor edits, like branding, stay open.
              </p>
            </Prose>
          </div>
        </InfoSection>

        <InfoSection
          id="organizer-responsibilities"
          eyebrow="Organizer guidelines"
          title="What we expect from organizers"
          intro="Listing on MUN Hub means agreeing to these standards for as long as your conference is live, as set out in our Terms of service."
        >
          <Prose>
            <ul>
              <li>
                <strong>Only list conferences you're authorized to run</strong>,
                and keep your organization's details current.
              </li>
              <li>
                <strong>Keep your listing accurate.</strong> Update it as soon
                as something changes, and never advertise committees, speakers,
                or venues that aren't confirmed.
              </li>
              <li>
                <strong>Honor what you publish:</strong> the passes, prices,
                and seat limits delegates registered against.
              </li>
              <li>
                <strong>Don't promise refunds.</strong> Payments on MUN Hub are
                final, as set out in our{" "}
                <Link to="/legal/refunds">Refund policy</Link>, so never tell
                delegates otherwise.
              </li>
              <li>
                <strong>Tell delegates about changes promptly</strong>,
                especially changes to dates, venue, or schedule, and
                cancellations.
              </li>
              <li>
                <strong>Use delegate information only to run your conference.</strong>{" "}
                Don't sell it, share it, or add delegates to unrelated
                marketing lists. See our{" "}
                <Link to="/legal/privacy">Privacy policy</Link>.
              </li>
              <li>
                <strong>Keep delegates safe.</strong> Many are under 18. Your
                conference must provide a respectful, supervised environment
                free from harassment.
              </li>
              <li>
                <strong>Respond to us and to delegates</strong> within a
                reasonable time when questions or issues come up.
              </li>
            </ul>
          </Prose>
        </InfoSection>

        <InfoSection
          eyebrow="Setting expectations"
          title="What a verified listing does and doesn't mean"
        >
          <div className="grid max-w-5xl gap-lg md:grid-cols-2">
            <MeaningCard
              kind="does"
              heading="It does mean"
              points={[
                "A real, approved organization is behind the conference.",
                "The organizer confirmed the details, and our team reviewed them.",
                "Important changes after launch were reviewed again.",
                "Your registration is confirmed only after your payment is verified.",
              ]}
            />
            <MeaningCard
              kind="doesnt"
              heading="It doesn't mean"
              points={[
                "That MUN Hub runs the conference. The organizer is responsible for delivering it.",
                "A rating of the debate quality, the chairing, or the overall experience.",
                "A guarantee that nothing will change. Conferences can still be rescheduled or cancelled, and payments aren't refunded if that happens.",
              ]}
            />
          </div>
        </InfoSection>

        <InfoSection
          id="enforcement"
          eyebrow="Enforcement"
          title="When we decline or remove a listing"
        >
          <Prose>
            <p>We may request changes, suspend, reject, or remove a conference if:</p>
            <ul>
              <li>we can't verify the organizer or their authority to run the conference</li>
              <li>it duplicates or impersonates another conference or organization</li>
              <li>its information is false or misleading, or stays wrong after we ask for a fix</li>
              <li>the organizer doesn't honor published prices or passes, or promises delegates refunds</li>
              <li>we have credible concerns about delegate safety, or about unlawful activity</li>
            </ul>
            <p>
              Delegates who have already registered for a suspended or removed
              conference will hear from us directly about what happens to
              their registration.
            </p>
          </Prose>
        </InfoSection>

        <SignatureCard
          id="report"
          variant="cream"
          padding="xl"
          className="scroll-mt-24 gap-xl lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="max-w-2xl">
            <SignatureCardEyebrow className="opacity-60">Spotted a problem?</SignatureCardEyebrow>
            <SignatureCardTitle>Report a listing that doesn't look right.</SignatureCardTitle>
            <SignatureCardDescription className="text-title-md text-[#333840] opacity-100">
              Wrong dates, an unofficial organizer, or a safety concern: tell
              us and we'll look into it. Reports help keep the marketplace
              trustworthy for everyone.
            </SignatureCardDescription>
          </div>
          <SignatureCardActions className="mt-0 shrink-0">
            <Button render={<Link to="/contact#report" />}>Report a concern</Button>
          </SignatureCardActions>
        </SignatureCard>
      </div>
    </InfoPageShell>
  );
}

function SignOffCard({ who, quote, body }: { who: string; quote: string; body: string }) {
  return (
    <figure className="flex flex-col gap-sm rounded-lg bg-surface-soft p-lg">
      <figcaption className="text-caption uppercase tracking-[0.16px] text-muted-foreground">
        {who}
      </figcaption>
      <blockquote className="font-display text-title-lg text-ink">“{quote}”</blockquote>
      <p className="text-base leading-7 text-body dark:text-muted-foreground">{body}</p>
    </figure>
  );
}

function MeaningCard({
  kind,
  heading,
  points,
}: {
  kind: "does" | "doesnt";
  heading: string;
  points: string[];
}) {
  const Icon = kind === "does" ? CheckIcon : XIcon;
  return (
    <div className="rounded-lg border border-border p-lg">
      <h3 className="font-display text-title-sm font-medium text-ink">{heading}</h3>
      <ul className="mt-md flex flex-col gap-sm">
        {points.map((point) => (
          <li key={point} className="flex gap-sm text-base leading-7 text-body dark:text-muted-foreground">
            <Icon
              aria-hidden
              className={
                kind === "does"
                  ? "mt-1.5 size-4 shrink-0 text-success-text"
                  : "mt-1.5 size-4 shrink-0 text-muted-foreground"
              }
            />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
