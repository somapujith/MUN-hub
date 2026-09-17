import { Link } from "react-router";
import { ArrowRightIcon } from "lucide-react";
import { InfoPageShell, InfoSection, PageHero } from "@/components/content/info-page";
import { LEGAL_DOCUMENTS } from "@/lib/legal-documents";
import { SITE_INFO, mailto } from "@/lib/site-info";

const RELATED = [
  {
    href: "/about/curation",
    label: "Curation standards",
    description: "How we review organizers and listings before and after they go live.",
  },
  {
    href: "/about",
    label: "What is MUN Hub",
    description: "What the platform does for delegates and organizers.",
  },
  {
    href: "/contact",
    label: "Contact",
    description: "Support, organizer help, reports, and privacy requests.",
  },
];

export function LegalIndexPage() {
  return (
    <InfoPageShell
      title="Legal"
      description="MUN Hub's Terms of service, Privacy policy, and Refund policy in one place."
    >
      <PageHero
        eyebrow="Legal"
        title="Our policies, in plain language"
        lede="These documents set out how MUN Hub works, how we handle your data, and why payments are final. Each one starts with a short summary."
      >
        <p className="text-body-md text-muted-foreground">
          Last updated {SITE_INFO.policiesLastUpdated}
        </p>
      </PageHero>

      <div className="content-container flex flex-col gap-section py-xxl md:py-section">
        <ul className="grid gap-lg md:grid-cols-3">
          {LEGAL_DOCUMENTS.map((doc) => (
            <li key={doc.href}>
              <Link
                to={doc.href}
                className="group flex h-full flex-col gap-sm rounded-lg border border-border p-lg transition-colors duration-150 hover:border-border-strong hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
              >
                <h2 className="font-display text-title-lg font-normal text-ink">{doc.label}</h2>
                <p className="text-base leading-7 text-body dark:text-muted-foreground">
                  {doc.description}
                </p>
                <span className="mt-auto inline-flex items-center gap-xxs pt-sm text-body-md font-medium text-link">
                  Read the {doc.label.toLowerCase()}
                  <ArrowRightIcon
                    aria-hidden
                    className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <InfoSection eyebrow="Also useful" title="Related pages">
          <ul className="grid max-w-5xl gap-x-xl gap-y-md md:grid-cols-3">
            {RELATED.map((item) => (
              <li key={item.href} className="border-t border-border pt-md">
                <Link
                  to={item.href}
                  className="rounded-sm text-label-md text-ink underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {item.label}
                </Link>
                <p className="mt-xxs text-body-md leading-relaxed text-body dark:text-muted-foreground">
                  {item.description}
                </p>
              </li>
            ))}
          </ul>
        </InfoSection>

        <InfoSection
          eyebrow="Questions"
          title="Something unclear?"
          intro={
            <>
              Email{" "}
              <a
                href={mailto(SITE_INFO.emails.support)}
                className="text-link underline underline-offset-4"
              >
                {SITE_INFO.emails.support}
              </a>{" "}
              about the terms or payments, or{" "}
              <a
                href={mailto(SITE_INFO.emails.privacy)}
                className="text-link underline underline-offset-4"
              >
                {SITE_INFO.emails.privacy}
              </a>{" "}
              about your personal data.
            </>
          }
        />
      </div>
    </InfoPageShell>
  );
}
