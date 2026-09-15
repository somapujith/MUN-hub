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
import { formatDateRange } from "@/components/shared/date-range";
import { queryKeys } from "@/api/query-keys";
import { getMockMunBySlug } from "@/mocks/data";
import { fetchMockUserProfile } from "@/mocks/session";
import { fetchProductsAvailability } from "@/mocks/registrations";
import { useSession } from "@/hooks/use-session";
import { NotFoundPage } from "@/pages/NotFoundPage";
import type { ProductWithAvailability } from "@/components/registration/types";

export function RegisterPage() {
  const { slug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const preselectedProductId = searchParams.get("product") ?? undefined;
  const { data: session } = useSession();

  const mun = getMockMunBySlug(slug);
  if (!mun) return <NotFoundPage />;

  const productIds = mun.registrationProducts.map((p) => p.id);
  const availabilityQuery = useQuery({
    queryKey: queryKeys.productAvailability(productIds),
    queryFn: () => fetchProductsAvailability(productIds),
    staleTime: 0,
    refetchInterval: 15_000,
    enabled: mun.status === "REGISTRATION_OPEN",
  });

  const profileQuery = useQuery({
    queryKey: queryKeys.userProfile(session?.userId ?? ""),
    queryFn: () => fetchMockUserProfile(session!.userId),
    enabled: Boolean(session),
  });

  const dateRange = formatDateRange(mun.startDate, mun.endDate);
  const location = [mun.city, mun.country].filter(Boolean).join(", ");

  if (mun.status !== "REGISTRATION_OPEN") {
    return (
      <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow session={session}>
        <Helmet><title>Register — {mun.name}</title></Helmet>
        <RegistrationNotice
          tone="neutral"
          title="Registration isn't open"
          message={
            mun.status === "REGISTRATION_CLOSED"
              ? `Registration for ${mun.name} has closed.`
              : `${mun.name} hasn't opened registration yet.`
          }
        >
          <Button render={<Link to={`/mun/${slug}`} />}>View conference</Button>
          <Button variant="outline" render={<Link to="/muns" />}>Browse other MUNs</Button>
        </RegistrationNotice>
      </RegistrationShell>
    );
  }

  const availabilityMap = new Map(
    (availabilityQuery.data ?? []).map((a) => [a.productId, a]),
  );

  const availability: ProductWithAvailability[] = mun.registrationProducts.map((product) => {
    const live = availabilityMap.get(product.id);
    return {
      product,
      capacity: live?.capacity ?? product.capacity,
      taken: live?.taken ?? 0,
      available: live?.available ?? product.capacity,
      deadlinePassed: hasPassed(product.deadline),
    };
  });

  if (availability.length === 0) {
    return (
      <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow session={session}>
        <RegistrationNotice tone="neutral" title="No registration options yet" message={`${mun.name} is open but hasn't published any passes.`}>
          <Button render={<Link to={`/mun/${slug}`} />}>View conference</Button>
        </RegistrationNotice>
      </RegistrationShell>
    );
  }

  const anySeatsLeft = availability.some((e) => e.available > 0);
  if (!anySeatsLeft) {
    return (
      <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} narrow session={session}>
        <RegistrationNotice tone="warning" title="Every pass is sold out" message={`All seats for ${mun.name} are taken.`}>
          <Button render={<Link to={`/mun/${slug}`} />}>View conference</Button>
        </RegistrationNotice>
      </RegistrationShell>
    );
  }

  const profile = profileQuery.data;

  return (
    <RegistrationShell munName={mun.name} dateRange={dateRange} location={location} session={session}>
      <Helmet><title>Register — {mun.name}</title></Helmet>
      <RegistrationFormMock
        slug={slug}
        munName={mun.name}
        products={availability}
        committees={mun.committees}
        preselectedProductId={
          availability.some((e) => e.product.id === preselectedProductId)
            ? preselectedProductId
            : undefined
        }
        defaults={{
          fullName: profile?.name ?? "",
          email: profile?.email ?? "",
          phone: profile?.phone ?? "",
          institution: profile?.institution ?? "",
        }}
      />
    </RegistrationShell>
  );
}

function RegistrationShell({
  munName,
  dateRange,
  location,
  narrow = false,
  session,
  children,
}: {
  munName: string;
  dateRange: string;
  location: string;
  narrow?: boolean;
  session?: { userId: string; role: string } | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader session={session ?? null} />
      <main className={cn("mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-xl sm:px-xl", narrow ? "max-w-2xl justify-center" : "max-w-5xl")}>
        <header className="flex flex-col gap-xs border-b border-border pb-lg">
          <p className="text-caption uppercase text-muted-foreground">Registration</p>
          <h1 className="font-display text-display-md text-ink text-balance">{munName}</h1>
          <div className="flex flex-wrap items-center gap-md text-body-md text-muted-foreground">
            <span className="inline-flex items-center gap-xs"><CalendarIcon className="size-4" aria-hidden />{dateRange}</span>
            {location && (
              <span className="inline-flex items-center gap-xs"><MapPinIcon className="size-4" aria-hidden />{location}</span>
            )}
          </div>
        </header>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
