import { Helmet } from "react-helmet-async";
import { Link, useParams } from "react-router";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { MunHero } from "@/components/mun/mun-hero";
import { CommitteeList } from "@/components/mun/committee-list";
import { RegistrationProductCard } from "@/components/mun/registration-product-card";
import { Button } from "@/components/ui/button";
import {
  SignatureCard,
  SignatureCardDescription,
  SignatureCardEyebrow,
  SignatureCardTitle,
} from "@/components/ui/signature-card";
import { getMockMunBySlug, getMockProductsAvailability } from "@/mocks/data";
import { cn } from "cn";
import { NotFoundPage } from "@/pages/not-found-page";

export function MunDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const mun = slug ? getMockMunBySlug(slug) : null;

  if (!mun) {
    return <NotFoundPage />;
  }

  const canRegister = mun.status === "REGISTRATION_OPEN";
  const products = mun.registrationProducts;
  const availability = getMockProductsAvailability(products.map((p) => p.id));

  const prices = products.map((product) => product.price);
  const fromPrice = prices.length > 0 ? Math.min(...prices) : null;

  const featuredProductId =
    products.length > 1
      ? products.reduce((cheapest, product) =>
          product.price < cheapest.price ? product : cheapest,
        ).id
      : null;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <Helmet>
        <title>{mun.name} | MUN Hub</title>
        <meta
          name="description"
          content={mun.description ?? `${mun.name} — register on MUN Hub.`}
        />
      </Helmet>

      <SiteHeader />

      <main className="flex-1">
        <MunHero mun={mun} fromPrice={fromPrice} />

        <section className="content-container pt-xxl pb-xxl md:pt-section md:pb-section">
          {mun.description && (
            <div className="max-w-3xl">
              <h2 className="font-display text-title-lg font-normal text-ink md:text-display-md">
                About this conference
              </h2>
              <p className="mt-md text-title-md leading-relaxed font-normal text-body">
                {mun.description}
              </p>
            </div>
          )}

          <div className={mun.description ? "mt-xxl" : undefined}>
            <div className="flex flex-wrap items-baseline justify-between gap-sm">
              <h2 className="font-display text-title-lg font-normal text-ink md:text-display-md">
                Committees
              </h2>
              {mun.committees.length > 0 && (
                <p className="text-body-md tabular-nums text-muted-foreground">
                  {mun.committees.length}{" "}
                  {mun.committees.length === 1 ? "committee" : "committees"} ·{" "}
                  {mun.committees.reduce((sum, c) => sum + c.portfolios.length, 0)} portfolios
                </p>
              )}
            </div>

            <div className="mt-lg">
              <CommitteeList committees={mun.committees} />
            </div>
          </div>
        </section>

        <section className="content-container pb-xxl md:pb-section">
          <SignatureCard variant="cream" padding="xl">
            <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <SignatureCardEyebrow>About the organizer</SignatureCardEyebrow>
                <SignatureCardTitle>
                  {mun.organizerName ?? "Independent organizer"}
                </SignatureCardTitle>
                <SignatureCardDescription className="text-[#333840] opacity-100">
                  Every conference on MUN Hub is reviewed and verified before it goes live —
                  organizer identity, venue details, and registration terms are checked by our
                  team, so delegates register with confidence.
                </SignatureCardDescription>
              </div>

              <div className="flex flex-wrap gap-sm lg:justify-end">
                <Button variant="on-dark" render={<Link to="/muns" />}>
                  Browse all conferences
                </Button>
              </div>
            </div>
          </SignatureCard>
        </section>

        <section id="registration" className="scroll-mt-xl bg-surface-soft">
          <div className="content-container pt-xxl pb-xxl md:pt-section md:pb-section">
            <div className="max-w-3xl">
              <h2 className="font-pricing text-pricing-section text-pricing-ink">
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
