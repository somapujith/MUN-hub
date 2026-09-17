import * as React from "react";
import { Link } from "react-router";
import { InfoPageShell, PageHero, Prose } from "@/components/content/info-page";
import { LEGAL_DOCUMENTS, type LegalHref } from "@/lib/legal-documents";
import { SITE_INFO } from "@/lib/site-info";

export type LegalSection = {
  id: string;
  title: string;
  body: React.ReactNode;
};

/**
 * Layout for a single policy: hero with a plain-language summary, a switcher
 * between the three policies, and numbered sections with a table of contents
 * (sticky rail on desktop, collapsible on mobile).
 */
export function LegalDocument({
  href,
  title,
  description,
  lede,
  summary,
  sections,
}: {
  href: LegalHref;
  title: string;
  description: string;
  lede: React.ReactNode;
  /** "The short version" — a handful of plain-language bullets. */
  summary: React.ReactNode[];
  sections: LegalSection[];
}) {
  return (
    <InfoPageShell title={title} description={description}>
      <PageHero eyebrow="Legal" title={title} lede={lede}>
        <p className="text-body-md text-muted-foreground">
          Last updated {SITE_INFO.policiesLastUpdated}
        </p>
      </PageHero>

      <div className="content-container pt-lg">
        <LegalSwitcher current={href} />
      </div>

      <div className="content-container grid gap-xl pt-xl pb-section lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-xxl">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <details className="group rounded-md border border-border lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-md py-sm text-body-md font-medium text-ink [&::-webkit-details-marker]:hidden">
              On this page
              <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="border-t border-border px-md py-sm">
              <TableOfContents sections={sections} />
            </div>
          </details>
          <div className="hidden lg:block">
            <p className="text-caption uppercase tracking-[0.16px] text-muted-foreground">
              On this page
            </p>
            <div className="mt-sm">
              <TableOfContents sections={sections} />
            </div>
          </div>
        </aside>

        <article className="min-w-0">
          <div className="max-w-[68ch] rounded-md bg-signature-cream p-lg text-[#181d26]">
            <h2 className="font-display text-title-sm font-medium text-[#181d26]">
              The short version
            </h2>
            <ul className="mt-sm flex list-disc flex-col gap-xs pl-lg text-base leading-7 marker:text-[#181d26]/50">
              {summary.map((point, index) => (
                <li key={index} className="pl-xxs">
                  {point}
                </li>
              ))}
            </ul>
            <p className="mt-sm text-body-md text-[#333840]">
              This summary helps you find your way around. The full text below is what applies.
            </p>
          </div>

          <div className="mt-xxl flex flex-col gap-xxl">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-heading`}
                className="scroll-mt-24"
              >
                <h2
                  id={`${section.id}-heading`}
                  className="font-display text-title-lg font-normal text-ink"
                >
                  <span className="mr-xs text-muted-foreground tabular-nums">{index + 1}.</span>
                  {section.title}
                </h2>
                <Prose className="mt-md">{section.body}</Prose>
              </section>
            ))}
          </div>
        </article>
      </div>
    </InfoPageShell>
  );
}

function TableOfContents({ sections }: { sections: LegalSection[] }) {
  return (
    <nav aria-label="On this page">
      <ol className="flex flex-col gap-xxs">
        {sections.map((section, index) => (
          <li key={section.id}>
            <Link
              to={`#${section.id}`}
              className="flex gap-xs rounded-sm py-xxs text-body-md leading-snug text-muted-foreground transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="w-5 shrink-0 tabular-nums">{index + 1}.</span>
              <span>{section.title}</span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

const SWITCHER_LINK_CLASS =
  "block rounded-md px-md py-xs text-body-md whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function LegalSwitcher({ current }: { current: LegalHref }) {
  return (
    <nav aria-label="Legal documents" className="-mx-xxs overflow-x-auto">
      <ul className="flex w-max gap-xxs rounded-lg bg-surface-soft p-xxs">
        {LEGAL_DOCUMENTS.map((doc) => {
          const isCurrent = doc.href === current;
          return (
            <li key={doc.href}>
              <Link
                to={doc.href}
                aria-current={isCurrent ? "page" : undefined}
                // Plain concatenation, not `cn`: it would treat `text-body-md`
                // as a color and drop it in favor of the state's text color.
                className={`${SWITCHER_LINK_CLASS} ${
                  isCurrent
                    ? "bg-background font-medium text-ink ring-1 ring-border"
                    : "text-muted-foreground hover:text-ink"
                }`}
              >
                {doc.label}
              </Link>
            </li>
          );
        })}
        <li>
          <Link to="/legal" className={`${SWITCHER_LINK_CLASS} text-muted-foreground hover:text-ink`}>
            All policies
          </Link>
        </li>
      </ul>
    </nav>
  );
}
