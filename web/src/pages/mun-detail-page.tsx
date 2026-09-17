import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MunHero } from "@/components/mun/mun-hero";
import { CommitteeList } from "@/components/mun/committee-list";
import { RegistrationProductCard } from "@/components/mun/registration-product-card";
import { MunKeyFacts } from "@/components/mun/mun-key-facts";
import { MunSectionNav, type MunSectionNavItem } from "@/components/mun/mun-section-nav";
import {
  MunPageSection,
  SectionEmpty,
  SectionError,
  SectionSkeleton,
} from "@/components/mun/mun-page-section";
import { ExecutiveBoardList } from "@/components/mun/executive-board-list";
import { ScheduleByDay } from "@/components/mun/schedule-by-day";
import { AccommodationList } from "@/components/mun/accommodation-list";
import { DocumentList } from "@/components/mun/document-list";
import { FaqList } from "@/components/mun/faq-list";
import { MunGallery } from "@/components/mun/mun-gallery";
import { MunOfficialContact } from "@/components/mun/mun-official-contact";
import { galleryItems } from "@/components/mun/mun-format";
import { PageMeta } from "@/components/seo/page-meta";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SignatureCard,
  SignatureCardDescription,
  SignatureCardEyebrow,
  SignatureCardTitle,
} from "@/components/ui/signature-card";
import {
  getMunBySlug,
  getProductsAvailability,
  listPublicAccommodation,
  listPublicDocuments,
  listPublicExecutiveBoard,
  listPublicFaqs,
  listPublicMedia,
  listPublicSchedule,
} from "@/api/marketplace";
import { queryKeys } from "@/api/query-keys";
import { absoluteHttpUrl, buildMunEventJsonLd, metaDescription } from "@/lib/seo";
import { cn } from "cn";
import { NotFoundPage } from "@/pages/not-found-page";
import type { MunDetail } from "@/types";

/**
 * Public MUN page. The MUN itself comes from `GET /muns/:slug`; each content
 * section (schedule, board, documents, ...) is its own by-id public query,
 * started once the MUN resolved, so a slow or failing section never blocks
 * the rest of the page. Core sections (committees, schedule, documents) show
 * an empty state; optional ones (board, accommodation, gallery, FAQs) are
 * left out — and out of the section nav — when the organizer added nothing.
 */

function PageChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}

function MunDetailSkeleton() {
  return (
    <main aria-busy="true" className="flex-1">
      <p className="sr-only" role="status">
        Loading conference…
      </p>
      <div aria-hidden className="content-container flex flex-col gap-md pt-xxl pb-xxl md:pt-section">
        <Skeleton className="h-5 w-32 rounded-sm" />
        <Skeleton className="h-10 w-3/4 max-w-xl rounded-sm" />
        <Skeleton className="h-5 w-1/2 max-w-md rounded-sm" />
        <div className="mt-xl grid gap-xxl lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-sm">
            <Skeleton className="h-4 w-full rounded-sm" />
            <Skeleton className="h-4 w-11/12 rounded-sm" />
            <Skeleton className="h-4 w-4/5 rounded-sm" />
          </div>
          <Skeleton className="h-64 w-full rounded-md" />
        </div>
      </div>
    </main>
  );
}

/** One public section query, started only once the MUN is known. */
function useSection<T>(munId: string | undefined, section: string, fetcher: (munId: string) => Promise<T>) {
  return useQuery({
    queryKey: queryKeys.publicMunSection(munId ?? "", section),
    queryFn: () => fetcher(munId!),
    enabled: Boolean(munId),
  });
}

export function MunDetailPage({ slugOverride }: { slugOverride?: string } = {}) {
  const { slug: slugParam } = useParams<{ slug: string }>();
  const slug = slugOverride ?? slugParam;

  const munQuery = useQuery({
    queryKey: queryKeys.mun(slug ?? ""),
    queryFn: () => getMunBySlug(slug!),
    enabled: Boolean(slug),
  });

  const mun = munQuery.data ?? undefined;
  const munId = mun?.id;
  const productIds = mun ? mun.registrationProducts.map((p) => p.id) : [];
  const availabilityQuery = useQuery({
    queryKey: queryKeys.productAvailability(productIds),
    queryFn: () => getProductsAvailability(productIds),
    enabled: productIds.length > 0,
  });

  const scheduleQuery = useSection(munId, "schedule", listPublicSchedule);
  const boardQuery = useSection(munId, "executive-board", listPublicExecutiveBoard);
  const documentsQuery = useSection(munId, "documents", listPublicDocuments);
  const accommodationQuery = useSection(munId, "accommodation", listPublicAccommodation);
  const mediaQuery = useSection(munId, "media", listPublicMedia);
  const faqsQuery = useSection(munId, "faqs", listPublicFaqs);

  if (!slug) {
    return <NotFoundPage />;
  }

  if (munQuery.isLoading) {
    return (
      <PageChrome>
        <MunDetailSkeleton />
      </PageChrome>
    );
  }

  if (munQuery.isError) {
    return (
      <PageChrome>
        <main className="flex flex-1 flex-col items-center justify-center gap-md px-lg py-section text-center">
          <p className="text-body-md text-destructive-text">
            {munQuery.error instanceof Error
              ? munQuery.error.message
              : "Unable to load this conference right now."}
          </p>
          <Button variant="outline" onClick={() => void munQuery.refetch()}>
            Try again
          </Button>
        </main>
      </PageChrome>
    );
  }

  if (!mun) {
    return <NotFoundPage />;
  }

  const canRegister = mun.status === "REGISTRATION_OPEN";
  const products = mun.registrationProducts;
  const availability = new Map(Object.entries(availabilityQuery.data ?? {}));
  const soldOutProductIds = new Set(
    [...availability.entries()].filter(([, seats]) => seats.available === 0).map(([id]) => id),
  );

  const prices = products.map((product) => product.price);
  const fromPrice = prices.length > 0 ? Math.min(...prices) : null;

  const featuredProductId =
    products.length > 1
      ? products.reduce((cheapest, product) =>
          product.price < cheapest.price ? product : cheapest,
        ).id
      : null;

  const committeeRefs = mun.committees.map((committee) => ({ id: committee.id, name: committee.name }));
  const boardMembers = boardQuery.data ?? [];
  const accommodationOptions = accommodationQuery.data ?? [];
  const gallery = galleryItems(mediaQuery.data);
  const faqs = faqsQuery.data ?? [];

  const showBoard = boardQuery.isLoading || boardQuery.isError || boardMembers.length > 0;
  const accommodationNotProvided = mun.accommodationProvided === "NOT_PROVIDED";
  const showAccommodation =
    accommodationNotProvided ||
    mun.accommodationProvided === "PROVIDED" ||
    accommodationQuery.isLoading ||
    accommodationOptions.length > 0;
  const showGallery = gallery.photos.length > 0 || gallery.sponsors.length > 0;
  const showFaqs = faqs.length > 0;

  const navItems: MunSectionNavItem[] = [
    { id: "about", label: "Overview" },
    { id: "committees", label: "Committees" },
    ...(showBoard ? [{ id: "executive-board", label: "Executive board" }] : []),
    { id: "schedule", label: "Schedule" },
    ...(showAccommodation ? [{ id: "accommodation", label: "Accommodation" }] : []),
    { id: "documents", label: "Documents" },
    ...(showGallery ? [{ id: "gallery", label: "Gallery" }] : []),
    ...(showFaqs ? [{ id: "faqs", label: "FAQs" }] : []),
    { id: "contact", label: "Contact" },
    { id: "registration", label: "Passes" },
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <MunPageMeta mun={mun} soldOutProductIds={soldOutProductIds} />

      <SiteHeader />

      <main className="flex-1">
        <MunHero mun={mun} fromPrice={fromPrice} />

        <MunSectionNav items={navItems} />

        <div className="content-container grid gap-xxl pt-xxl pb-xxl md:pt-section md:pb-section lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Key facts come first on small screens (they answer "when/where"
              before the long read) and sit in a sticky right rail from lg. */}
          <aside aria-label="Key facts" className="lg:order-last">
            <div className="lg:sticky lg:top-[136px]">
              <MunKeyFacts mun={mun} />
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-xxl md:gap-section">
            <MunPageSection id="about" title="About this conference">
              {mun.description ? (
                <p className="max-w-[70ch] text-title-md leading-relaxed font-normal whitespace-pre-line text-body">
                  {mun.description}
                </p>
              ) : (
                <SectionEmpty>The organizers haven&apos;t added a description yet.</SectionEmpty>
              )}
            </MunPageSection>

            <MunPageSection
              id="committees"
              title="Committees"
              aside={
                mun.committees.length > 0 && (
                  <p className="text-body-md tabular-nums text-muted-foreground">
                    {mun.committees.length}{" "}
                    {mun.committees.length === 1 ? "committee" : "committees"} ·{" "}
                    {mun.committees.reduce((sum, c) => sum + c.portfolios.length, 0)} portfolios
                  </p>
                )
              }
            >
              <CommitteeList committees={mun.committees} />
            </MunPageSection>

            {showBoard && (
              <MunPageSection id="executive-board" title="Executive board">
                {boardQuery.isLoading ? (
                  <SectionSkeleton rows={2} />
                ) : boardQuery.isError ? (
                  <SectionError>We couldn&apos;t load the executive board right now.</SectionError>
                ) : (
                  <ExecutiveBoardList members={boardMembers} committees={committeeRefs} />
                )}
              </MunPageSection>
            )}

            <MunPageSection id="schedule" title="Schedule">
              {scheduleQuery.isLoading ? (
                <SectionSkeleton />
              ) : scheduleQuery.isError ? (
                <SectionError>We couldn&apos;t load the schedule right now.</SectionError>
              ) : (scheduleQuery.data ?? []).length === 0 ? (
                <SectionEmpty>The day-by-day schedule hasn&apos;t been published yet.</SectionEmpty>
              ) : (
                <ScheduleByDay items={scheduleQuery.data ?? []} committees={committeeRefs} />
              )}
            </MunPageSection>

            {showAccommodation && (
              <MunPageSection
                id="accommodation"
                title="Accommodation"
                description={
                  accommodationOptions.length > 0
                    ? canRegister
                      ? "Add a stay while you register — it is charged together with your pass."
                      : "Available to add during registration."
                    : undefined
                }
              >
                {accommodationQuery.isLoading ? (
                  <SectionSkeleton rows={2} />
                ) : accommodationQuery.isError ? (
                  <SectionError>We couldn&apos;t load accommodation options right now.</SectionError>
                ) : accommodationOptions.length > 0 ? (
                  <AccommodationList options={accommodationOptions} />
                ) : accommodationNotProvided ? (
                  <SectionEmpty>
                    The organizers don&apos;t arrange accommodation for this conference. Outstation
                    delegates should plan their own stay.
                  </SectionEmpty>
                ) : (
                  <SectionEmpty>Accommodation options haven&apos;t been published yet.</SectionEmpty>
                )}
              </MunPageSection>
            )}

            <MunPageSection id="documents" title="Documents">
              {documentsQuery.isLoading ? (
                <SectionSkeleton rows={2} />
              ) : documentsQuery.isError ? (
                <SectionError>We couldn&apos;t load the documents right now.</SectionError>
              ) : (documentsQuery.data ?? []).length === 0 ? (
                <SectionEmpty>No documents have been shared yet.</SectionEmpty>
              ) : (
                <DocumentList documents={documentsQuery.data ?? []} />
              )}
            </MunPageSection>

            {showGallery && (
              <MunPageSection id="gallery" title="Gallery">
                <MunGallery items={gallery} munName={mun.name} />
              </MunPageSection>
            )}

            {showFaqs && (
              <MunPageSection id="faqs" title="Frequently asked questions">
                <FaqList faqs={faqs} />
              </MunPageSection>
            )}
          </div>
        </div>

        <section
          id="contact"
          aria-labelledby="contact-heading"
          className="content-container scroll-mt-[136px] pb-xxl md:pb-section"
        >
          <SignatureCard variant="cream" padding="xl">
            <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <SignatureCardEyebrow>About the organizer</SignatureCardEyebrow>
                <SignatureCardTitle id="contact-heading" tabIndex={-1} className="outline-none">
                  {mun.organizerName ?? "Independent organizer"}
                </SignatureCardTitle>
                <SignatureCardDescription className="text-[#333840] opacity-100">
                  Every conference on MUN Hub is reviewed and verified before it goes live —
                  organizer identity, venue details, and registration terms are checked by our
                  team, so delegates register with confidence.
                </SignatureCardDescription>
                {mun.contact ? (
                  <MunOfficialContact contact={mun.contact} />
                ) : (
                  <p className="mt-lg text-body-md text-[#333840]">
                    Questions about this conference? Our support team can put you in touch.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-sm lg:justify-end">
                <Button variant="on-dark" render={<Link to="/muns" />}>
                  Browse all conferences
                </Button>
              </div>
            </div>
          </SignatureCard>
        </section>

        <section id="registration" className="scroll-mt-[136px] bg-surface-soft">
          <div className="content-container pt-xxl pb-xxl md:pt-section md:pb-section">
            <div className="max-w-3xl">
              <h2
                id="registration-heading"
                tabIndex={-1}
                className="font-pricing text-pricing-section text-pricing-ink outline-none"
              >
                Registration passes
              </h2>
              <p className="mt-sm text-body-md text-muted-foreground">
                {canRegister
                  ? "Choose a pass to begin registration. Seats are held briefly while you complete payment."
                  : "Registration isn't open for this conference right now. Passes are shown for reference."}
              </p>
            </div>

            {products.length === 0 ? (
              <div className="mt-lg rounded-md border border-dashed border-border-strong bg-card px-lg py-xl">
                <p className="text-body-md text-muted-foreground">
                  No registration passes have been published for this conference yet.
                </p>
              </div>
            ) : (
              <div
                className={cn(
                  "mt-xl grid grid-cols-1 gap-lg sm:grid-cols-2",
                  products.length >= 3 && "lg:grid-cols-3",
                  products.length === 1 && "sm:max-w-sm sm:grid-cols-1",
                )}
              >
                {products.map((product) => (
                  <RegistrationProductCard
                    key={product.id}
                    product={product}
                    availability={availability.get(product.id)}
                    canRegister={canRegister}
                    munSlug={mun.slug}
                    featured={product.id === featuredProductId}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function MunPageMeta({ mun, soldOutProductIds }: { mun: MunDetail; soldOutProductIds: ReadonlySet<string> }) {
  const where = [mun.city, mun.country].filter(Boolean).join(", ");
  const fallbackDescription = `${mun.name}${where ? ` in ${where}` : ""} — committees, schedule, fees and registration on MUN Hub.`;
  return (
    <PageMeta
      title={`${mun.name} | MUN Hub`}
      description={metaDescription(mun.description ?? mun.theme, fallbackDescription)}
      path={`/mun/${mun.slug}`}
      image={absoluteHttpUrl(mun.coverImage)}
      imageAlt={`${mun.name} cover image`}
      jsonLd={buildMunEventJsonLd(mun, { soldOutProductIds })}
    />
  );
}
