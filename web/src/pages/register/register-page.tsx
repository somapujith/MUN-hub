import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { CalendarIcon, MapPinIcon } from "lucide-react";
import { cn } from "cn";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { RegistrationForm } from "@/components/registration/registration-form";
import { RegistrationNotice } from "@/components/registration/registration-notice";
import { EmailVerificationNotice } from "@/components/dashboard/email-verification-notice";
import { hasPassed } from "@/components/registration/deadline";
import type { ProductWithAvailability } from "@/components/registration/types";
import { formatDateRange } from "@/components/shared/date-range";
import { queryKeys } from "@/api/query-keys";
import { getMunBySlug, getProductsAvailability, listPublicAccommodation } from "@/api/marketplace";
import { getProfileCompletion, getProfileFormDefaults } from "@/api/student-profile";
import { getAccountSettings } from "@/api/account";
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

  // Every hook runs before any early return — the previous version bailed to
  // <NotFoundPage /> above its useQuery calls, which changes the hook count
  // between renders and throws once a slug misses.
  const munQuery = useQuery({
    queryKey: queryKeys.mun(slug),
    queryFn: () => getMunBySlug(slug),
    enabled: slug !== "",
  });
  const mun = munQuery.data ?? null;

  const profileDefaultsQuery = useQuery({
    queryKey: queryKeys.profileFormDefaults(),
    queryFn: getProfileFormDefaults,
    enabled: Boolean(session?.userId),
  });

  const accountQuery = useQuery({
    queryKey: queryKeys.account(),
    queryFn: getAccountSettings,
    enabled: Boolean(session?.userId),
  });

  // The API refuses registrations until the one-time profile is complete, so
  // say so up front instead of after the delegate fills in the whole form.
  // Always refetched: the profile may have just been completed in another tab.
  const profileCompletionQuery = useQuery({
    queryKey: ["profile", "complete"],
    queryFn: getProfileCompletion,
    enabled: Boolean(session?.userId),
    refetchOnMount: "always",
  });

  const productIds = mun?.registrationProducts.map((product) => product.id) ?? [];
  // Accommodation the organizer sells with the pass — the MUN page tells
  // delegates they can add a stay while registering, so the funnel has to
  // offer it.
  const accommodationQuery = useQuery({
    queryKey: queryKeys.publicMunSection(mun?.id ?? "", "accommodation"),
    queryFn: () => listPublicAccommodation(mun!.id),
    enabled: Boolean(mun?.id) && mun?.status === "REGISTRATION_OPEN",
  });

  const availabilityQuery = useQuery({
    queryKey: queryKeys.productAvailability(productIds),
    queryFn: () => getProductsAvailability(productIds),
    enabled: mun?.status === "REGISTRATION_OPEN" && productIds.length > 0,
  });

  if (munQuery.isPending) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 px-lg py-xl" aria-busy="true" />
        <SiteFooter />
      </div>
    );
  }

  if (!mun) return <NotFoundPage />;

  const dateRange = formatDateRange(mun.startDate, mun.endDate);
  const location = [mun.city, mun.country].filter(Boolean).join(", ");

  if (mun.status !== "REGISTRATION_OPEN") {
    return (
      <>
        <Helmet>
          <title>{`Register — ${mun.name} | MUN Hub`}</title>
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
          <title>{`Register — ${mun.name} | MUN Hub`}</title>
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

  // RegistrationForm reads the profile/account defaults only once, in its
  // initial state — so it must not mount until they've loaded. Coming from
  // the MUN page, the mun + availability queries are already cached, and
  // without this the form mounted instantly with empty, never-updated fields.
  if (
    availabilityQuery.isPending ||
    accommodationQuery.isLoading ||
    profileDefaultsQuery.isLoading ||
    accountQuery.isLoading ||
    profileCompletionQuery.isLoading
  ) {
    return (
      <>
        <Helmet>
          <title>{`Register — ${mun.name} | MUN Hub`}</title>
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
          <title>{`Register — ${mun.name} | MUN Hub`}</title>
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

  // The API refuses the registration outright when verification is required,
  // so say it here rather than after the form is filled in.
  if (accountQuery.data && accountQuery.data.emailVerificationRequired && !accountQuery.data.emailVerified) {
    return (
      <>
        <Helmet>
          <title>{`Register — ${mun.name} | MUN Hub`}</title>
        </Helmet>
        <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow>
          <EmailVerificationNotice
            email={accountQuery.data.email}
            required
            variant="block"
          />
          <div className="flex flex-wrap gap-sm">
            <Button variant="outline" render={<Link to={`/mun/${slug}`} />}>
              View conference
            </Button>
            <Button variant="outline" render={<Link to="/dashboard" />}>
              Your dashboard
            </Button>
          </div>
        </RegistrationShell>
      </>
    );
  }

  if (profileCompletionQuery.data?.complete === false) {
    return (
      <>
        <Helmet>
          <title>{`Register — ${mun.name} | MUN Hub`}</title>
        </Helmet>
        <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow>
          <RegistrationNotice
            tone="warning"
            title="Complete your profile first"
            message="Organizers need your date of birth, school, address and emergency contact before you can register. You only fill this in once."
          >
            <Button render={<Link to="/profile" />}>Complete your profile</Button>
            <Button variant="outline" render={<Link to={`/mun/${slug}`} />}>
              View conference
            </Button>
          </RegistrationNotice>
        </RegistrationShell>
      </>
    );
  }

  const availabilityByProduct = availabilityQuery.data ?? {};
  const availability: ProductWithAvailability[] = mun.registrationProducts.map((product) => ({
    product,
    ...(availabilityByProduct[product.id] ?? {
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
          <title>{`Register — ${mun.name} | MUN Hub`}</title>
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

  const account = accountQuery.data;
  const validPreselected = availability.some(
    (entry) => entry.product.id === preselectedProductId,
  )
    ? preselectedProductId
    : undefined;

  return (
    <>
      <Helmet>
        <title>{`Register — ${mun.name} | MUN Hub`}</title>
        <meta
          name="description"
          content={`Reserve your delegate seat at ${mun.name}.`}
        />
      </Helmet>
      <RegistrationShell munName={mun.name} dateRange={dateRange} location={location}>
        <RegistrationForm
          slug={slug}
          munId={mun.id}
          munName={mun.name}
          products={availability}
          committees={mun.committees}
          formFields={mun.formFields ?? []}
          accommodationOptions={accommodationQuery.data ?? []}
          profileDefaults={profileDefaultsQuery.data ?? {}}
          accountDefaults={{
            fullName: account?.name ?? "",
            email: account?.email ?? "",
            phone: account?.phone ?? "",
          }}
          preselectedProductId={validPreselected}
        />
      </RegistrationShell>
    </>
  );
}
