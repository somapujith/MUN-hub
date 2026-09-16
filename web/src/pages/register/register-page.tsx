import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { CalendarIcon, MapPinIcon } from "lucide-react";
import { cn } from "cn";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { RegistrationFormMock } from "@/components/registration/registration-form-mock";
import { RegistrationNotice } from "@/components/registration/registration-notice";
import { hasPassed } from "@/components/registration/deadline";
import type { ProductWithAvailability } from "@/components/registration/types";
import { formatDateRange } from "@/components/shared/date-range";
import { queryKeys } from "@/api/query-keys";
import { getProductsAvailability } from "@/api/registration";
import { getMockMunBySlug } from "@/mocks/data";
import { fetchMockUserProfile } from "@/mocks/session";
import { useSession } from "@/hooks/use-session";
import { NotFoundPage } from "@/pages/not-found-page";

function RegistrationShell({
  munName,
  dateRange,
  location,
  narrow = false,
  children,
}: {
  munName: string;
  dateRange: string;
  location: string;
  narrow?: boolean;
  children: ReactNode;
}) {

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main
        className={cn(
          "mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-xl sm:px-xl",
          narrow ? "max-w-2xl justify-center" : "max-w-5xl",
        )}
      >
        <header className="flex flex-col gap-xs border-b border-border pb-lg">
          <p className="text-caption uppercase text-muted-foreground">Registration</p>
          <h1 className="font-display text-display-md text-ink text-balance">{munName}</h1>
          <div className="flex flex-wrap items-center gap-md text-body-md text-muted-foreground">
            <span className="inline-flex items-center gap-xs">
              <CalendarIcon className="size-4" aria-hidden />
              {dateRange}
            </span>
            {location && (
              <span className="inline-flex items-center gap-xs">
                <MapPinIcon className="size-4" aria-hidden />
                {location}
              </span>
            )}
          </div>
        </header>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

export function RegisterPage() {
  const { data: session } = useSession();
  const { slug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const preselectedProductId = searchParams.get("product") ?? undefined;

  const mun = getMockMunBySlug(slug);
  if (!mun) return <NotFoundPage />;

  const profileQuery = useQuery({
    queryKey: queryKeys.userProfile(session?.userId ?? ""),
    queryFn: () => fetchMockUserProfile(session!.userId),
    enabled: Boolean(session?.userId),
  });

  const productIds = mun.registrationProducts.map((product) => product.id);
  const availabilityQuery = useQuery({
    queryKey: queryKeys.productAvailability(productIds),
    queryFn: () => getProductsAvailability(productIds),
    enabled: mun.status === "REGISTRATION_OPEN" && productIds.length > 0,
  });

  const dateRange = formatDateRange(mun.startDate, mun.endDate);
  const location = [mun.city, mun.country].filter(Boolean).join(", ");

  if (mun.status !== "REGISTRATION_OPEN") {
    return (
      <>
        <Helmet>
          <title>Register — {mun.name}</title>
        </Helmet>
        <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow>
          <RegistrationNotice
            tone="neutral"
            title="Registration isn't open"
            message={
              mun.status === "REGISTRATION_CLOSED"
                ? `Registration for ${mun.name} has closed. Watch the conference page for waitlist or late-registration announcements.`
                : `${mun.name} hasn't opened registration yet. Check the conference page for the announcement date.`
            }
          >
            <Button render={<Link to={`/mun/${slug}`} />}>View conference</Button>
            <Button variant="outline" render={<Link to="/muns" />}>
              Browse other MUNs
            </Button>
          </RegistrationNotice>
        </RegistrationShell>
      </>
    );
  }

  if (productIds.length === 0) {
    return (
      <>
        <Helmet>
          <title>Register — {mun.name}</title>
        </Helmet>
        <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow>
          <RegistrationNotice
            tone="neutral"
            title="No registration options yet"
            message={`${mun.name} is open but hasn't published any registration passes. Check back shortly.`}
          >
            <Button render={<Link to={`/mun/${slug}`} />}>View conference</Button>
          </RegistrationNotice>
        </RegistrationShell>
      </>
    );
  }

  if (availabilityQuery.isPending) {
    return (
      <>
        <Helmet>
          <title>Register — {mun.name}</title>
        </Helmet>
        <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow>
          <div aria-busy="true" className="py-xxl" />
        </RegistrationShell>
      </>
    );
  }

  if (availabilityQuery.isError) {
    return (
      <>
        <Helmet>
          <title>Register — {mun.name}</title>
        </Helmet>
        <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow>
          <RegistrationNotice
            tone="error"
            title="Couldn't load seat availability"
            message="Something went wrong loading registration options. Try again."
          >
            <Button render={<Link to={`/mun/${slug}`} />}>View conference</Button>
          </RegistrationNotice>
        </RegistrationShell>
      </>
    );
  }

  const availabilityByProduct = availabilityQuery.data ?? new Map();
  const availability: ProductWithAvailability[] = mun.registrationProducts.map((product) => ({
    product,
    ...(availabilityByProduct.get(product.id) ?? {
      capacity: product.capacity,
      taken: 0,
      available: product.capacity,
    }),
    deadlinePassed: product.deadline ? hasPassed(product.deadline) : false,
  }));

  const anySeatsLeft = availability.some((entry) => entry.available > 0);
  if (!anySeatsLeft) {
    return (
      <>
        <Helmet>
          <title>Register — {mun.name}</title>
        </Helmet>
        <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow>
          <RegistrationNotice
            tone="warning"
            title="Every pass is sold out"
            message={`All ${availability.reduce((sum, entry) => sum + entry.capacity, 0)} seats for ${mun.name} are taken. Seats occasionally free up when a reservation expires — it's worth checking back.`}
          >
            <Button render={<Link to={`/mun/${slug}`} />}>View conference</Button>
            <Button variant="outline" render={<Link to="/muns" />}>
              Browse other MUNs
            </Button>
          </RegistrationNotice>
        </RegistrationShell>
      </>
    );
  }

  const profile = profileQuery.data;
  const validPreselected = availability.some(
    (entry) => entry.product.id === preselectedProductId,
  )
    ? preselectedProductId
    : undefined;

  return (
    <>
      <Helmet>
        <title>Register — {mun.name}</title>
        <meta
          name="description"
          content={`Reserve your delegate seat at ${mun.name}.`}
        />
      </Helmet>
      <RegistrationShell munName={mun.name} dateRange={dateRange} location={location}>
        <RegistrationFormMock
          slug={slug}
          munId={mun.id}
          munName={mun.name}
          products={availability}
          committees={mun.committees}
          preselectedProductId={validPreselected}
          defaults={{
            fullName: profile?.name ?? "",
            email: profile?.email ?? "",
            phone: profile?.phone ?? "",
            institution: profile?.institution ?? "",
          }}
        />
      </RegistrationShell>
    </>
  );
}
