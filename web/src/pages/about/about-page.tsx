import { Link } from "react-router";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardListIcon,
  CompassIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  ScaleIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import { InfoPageShell, InfoSection, PageHero } from "@/components/content/info-page";
import { RegisteredBusinessDetails } from "@/components/content/registered-business-details";
import { Button } from "@/components/ui/button";
import {
  SignatureCard,
  SignatureCardActions,
  SignatureCardDescription,
  SignatureCardEyebrow,
  SignatureCardTitle,
} from "@/components/ui/signature-card";
import { useListYourMunHref } from "@/hooks/use-list-your-mun-href";

type Feature = { icon: LucideIcon; title: string; body: string };

const DELEGATE_FEATURES: Feature[] = [
  {
    icon: CompassIcon,
    title: "Discover",
    body: "Browse every reviewed conference in one place and narrow it down by city, dates, registration status, and delegate fee.",
  },
  {
    icon: ScaleIcon,
    title: "Compare like for like",
    body: "Every listing follows the same format — dates, venue, committees, agendas, portfolios, passes, and fees — so you can weigh conferences side by side.",
  },
  {
    icon: UserRoundIcon,
    title: "Register once, reuse everywhere",
    body: "Fill in your profile once. Your details pre-fill each conference's registration form, and you can still edit them per conference.",
  },
  {
    icon: LayoutDashboardIcon,
    title: "Track every registration",
    body: "Your dashboard shows each registration and where it stands, from payment pending to confirmed.",
  },
];

const ORGANIZER_FEATURES: Feature[] = [
  {
    icon: ShieldCheckIcon,
    title: "Get verified once",
    body: "Create an organizer account and apply with your organization's details. When we approve you, you get a workspace to build your conference.",
  },
  {
    icon: ClipboardListIcon,
    title: "Build a complete listing",
    body: "Set up committees, portfolios, your executive board, registration passes, your registration form, your schedule, and your documents in one guided checklist.",
  },
  {
    icon: CreditCardIcon,
    title: "Take registrations and payments",
    body: "Delegates register and pay on MUN Hub. We enforce seat limits automatically, so a pass can never be oversold.",
  },
  {
    icon: UsersRoundIcon,
    title: "Manage delegates in one place",
    body: "See every registration, its payment status, and the delegate's details without juggling spreadsheets and form exports.",
  },
];

const JOURNEY = [
  {
    title: "The organizer applies",
    body: "We check that the organization is real and authorized to run the conference.",
  },
  {
    title: "They build and confirm the listing",
    body: "The organizer completes every required section, then formally confirms the details are accurate.",
  },
  {
    title: "Our team reviews it",
    body: "We check dates, venue, pricing, committees, and contact details before anything is published.",
  },
  {
    title: "The conference goes live",
    body: "The listing appears in the marketplace, and registration opens when the organizer is ready.",
  },
  {
    title: "Delegates register and pay",
    body: "A seat is held while you pay. Your registration is confirmed only after we verify the payment.",
  },
];

const PRINCIPLES = [
  {
    title: "Trust before growth",
    body: "Only reviewed conferences are listed. We would rather list fewer conferences than list ones we can't stand behind.",
  },
  {
    title: "Comparable information",
    body: "Every conference presents the same essentials in the same place.",
  },
  {
    title: "Organizers own their content",
    body: "Secretariats decide their committees, agendas, passes, and policies. We make sure it's accurate and complete.",
  },
  {
    title: "We own the publishing gate",
    body: "Nobody can skip review, and major changes after publication go back through it.",
  },
  {
    title: "Payments you can rely on",
    body: "A registration counts only once the payment has been verified on our servers. A success screen alone doesn't confirm it.",
  },
];

export function AboutPage() {
  // null for signed-in delegates and staff: they never get an organizer-registration link.
  const listYourMunHref = useListYourMunHref();

  return (
    <InfoPageShell
      title="What is MUN Hub"
      description="MUN Hub is a curated marketplace for Model United Nations conferences. Delegates discover and register for reviewed conferences, and organizers run registrations from one workspace."
    >
      <PageHero
        eyebrow="About MUN Hub"
        title="One trusted place to find and join Model UN conferences"
        lede="MUN Hub is a curated marketplace for Model United Nations. Delegates discover, compare, and register for conferences in one place. Organizers get a proper registration and management workspace. Our team reviews every conference before it goes live."
        image="/images/about-hero.jpg"
      >
        <div className="mt-sm flex flex-wrap gap-sm">
          <Button render={<Link to="/muns" />}>Browse conferences</Button>
          {listYourMunHref ? (
            <Button variant="outline" render={<Link to={listYourMunHref} />}>
              List your MUN
            </Button>
          ) : null}
        </div>
      </PageHero>

      <div className="content-container flex flex-col gap-section py-xxl md:py-section">
        <InfoSection
          eyebrow="Why we exist"
          title="Finding a MUN shouldn't take a group chat and five Google Forms"
        >
          <div className="grid max-w-5xl gap-lg md:grid-cols-2">
            <ProblemCard
              heading="For delegates today"
              points={[
                "Conferences are announced across Instagram, WhatsApp groups, and word of mouth.",
                "Each one shares different details, which makes dates, committees, and fees hard to compare.",
                "Every registration is a new form, with a different payment method each time.",
              ]}
            />
            <ProblemCard
              heading="For organizers today"
              points={[
                "Registrations get built by hand and tracked in spreadsheets.",
                "Payments come through separate links and have to be matched manually.",
                "New delegates are hard to reach beyond your own network.",
              ]}
            />
          </div>
          <p className="mt-lg max-w-[62ch] text-base leading-7 text-body dark:text-muted-foreground">
            MUN Hub replaces that with one standard: a single place to discover
            conferences, one consistent listing format, and one reliable way to
            register and pay.
          </p>
        </InfoSection>

        <InfoSection
          eyebrow="For delegates"
          title="Everything you need to choose your next conference"
        >
          <FeatureGrid features={DELEGATE_FEATURES} />
        </InfoSection>

        <InfoSection
          eyebrow="For organizers"
          title="Run registration without the spreadsheets"
        >
          <FeatureGrid features={ORGANIZER_FEATURES} />
        </InfoSection>

        <InfoSection
          id="how-it-works"
          eyebrow="How it works"
          title="From application to confirmed delegate"
          intro="Each conference goes through the same path before anyone can register."
        >
          <ol className="grid gap-md sm:grid-cols-2 lg:grid-cols-5">
            {JOURNEY.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-xs border-t-2 border-ink pt-md">
                <span className="text-caption text-muted-foreground tabular-nums">
                  Step {index + 1}
                </span>
                <h3 className="font-display text-title-sm font-medium text-ink">{step.title}</h3>
                <p className="text-body-md leading-relaxed text-body dark:text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </InfoSection>

        <SignatureCard
          variant="cream"
          padding="xl"
          className="gap-xl lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="max-w-2xl">
            <SignatureCardEyebrow className="opacity-60">What "curated" means</SignatureCardEyebrow>
            <SignatureCardTitle>Every listing is checked by a person before it goes live.</SignatureCardTitle>
            <SignatureCardDescription className="text-title-md text-[#333840] opacity-100">
              We verify the organizer, review the conference details section by
              section, and review listings again when important details change
              after publication.
            </SignatureCardDescription>
          </div>
          <SignatureCardActions className="mt-0 shrink-0">
            <Button render={<Link to="/about/curation" />}>Read our curation standards</Button>
          </SignatureCardActions>
        </SignatureCard>

        <InfoSection eyebrow="What we stand for" title="The principles behind MUN Hub">
          <dl className="grid max-w-5xl gap-x-xl gap-y-lg md:grid-cols-2">
            {PRINCIPLES.map((principle) => (
              <div key={principle.title} className="border-l-2 border-signature-coral pl-md">
                <dt className="font-display text-title-sm font-medium text-ink">{principle.title}</dt>
                <dd className="mt-xxs text-base leading-7 text-body dark:text-muted-foreground">
                  {principle.body}
                </dd>
              </div>
            ))}
          </dl>
        </InfoSection>

        <InfoSection
          eyebrow="Where we are"
          title="Starting in Hyderabad, growing city by city"
          intro="We're starting with the Hyderabad conference circuit and adding cities as organizers join. If you run a MUN anywhere, we'd like to hear from you."
        />

        <InfoSection
          id="registered-business"
          eyebrow="Registered business"
          title="Who operates MUN Hub"
        >
          <RegisteredBusinessDetails />
        </InfoSection>

        <SignatureCard variant="dark" className="items-center">
          <div className="max-w-2xl text-center">
            <SignatureCardTitle>Ready when you are.</SignatureCardTitle>
            <SignatureCardDescription className="mx-auto text-title-md opacity-85">
              Find your next committee, or put your conference in front of the
              delegates already looking for one.
            </SignatureCardDescription>
            <SignatureCardActions className="justify-center">
              <Button variant="on-dark" render={<Link to="/muns" />}>
                Browse MUNs
              </Button>
            </SignatureCardActions>
            <p className="mt-lg text-body-md text-on-dark/70 dark:text-foreground/70">
              Questions first?{" "}
              <Link
                to="/contact"
                className="rounded-sm text-on-dark underline underline-offset-4 transition-opacity duration-150 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-on-dark focus-visible:ring-offset-4 focus-visible:ring-offset-surface-dark focus-visible:outline-none dark:text-foreground dark:focus-visible:ring-foreground dark:focus-visible:ring-offset-surface-strong"
              >
                Contact us
              </Link>
            </p>
          </div>
        </SignatureCard>
      </div>
    </InfoPageShell>
  );
}

function ProblemCard({ heading, points }: { heading: string; points: string[] }) {
  return (
    <div className="rounded-lg bg-surface-soft p-lg">
      <h3 className="font-display text-title-sm font-medium text-ink">{heading}</h3>
      <ul className="mt-sm flex list-disc flex-col gap-xs pl-lg text-base leading-7 text-body marker:text-muted-foreground dark:text-muted-foreground">
        {points.map((point) => (
          <li key={point} className="pl-xxs">
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureGrid({ features }: { features: Feature[] }) {
  return (
    <ul className="grid gap-lg sm:grid-cols-2 lg:grid-cols-4">
      {features.map(({ icon: Icon, title, body }) => (
        <li key={title} className="flex flex-col gap-sm rounded-lg border border-border p-lg">
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-md bg-surface-soft text-ink"
          >
            <Icon className="size-5" />
          </span>
          <h3 className="font-display text-title-sm font-medium text-ink">{title}</h3>
          <p className="text-body-md leading-relaxed text-body dark:text-muted-foreground">{body}</p>
        </li>
      ))}
    </ul>
  );
}
