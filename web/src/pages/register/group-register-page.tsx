import * as React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, Loader2Icon, UsersRound } from "lucide-react";
import { cn } from "cn";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RegistrationNotice } from "@/components/registration/registration-notice";
import { StepIndicator } from "@/components/registration/step-indicator";
import { hasPassed } from "@/components/registration/deadline";
import { currentPassPrice } from "@/components/registration/pricing";
import { previewFeeBreakdownAdditive } from "@/components/registration/fees-preview";
import { formatPrice } from "@/components/shared/currency";
import { formatDateRange } from "@/components/shared/date-range";
import {
  CORE_KEYS,
  CORE_LABELS,
  DynamicField,
  controlClassName,
  isFieldVisible,
} from "@/components/registration/dynamic-field";
import { queryKeys } from "@/api/query-keys";
import { getMunBySlug, getProductsAvailability } from "@/api/marketplace";
import { getProfileFormDefaults } from "@/api/student-profile";
import { getAccountSettings } from "@/api/account";
import { fetchFeeRates } from "@/api/registration";
import {
  GROUP_MAX_SIZE,
  GROUP_MIN_SIZE,
  initiateGroupRegistration,
} from "@/api/registration-group";
import { useSession } from "@/hooks/use-session";
import { NotFoundPage } from "@/pages/not-found-page";

const STEPS = ["Team size", "Your details", "Review"] as const;

/**
 * Group/delegation registration — the head delegate's own funnel. Reserves
 * and pays for `teamSize` seats in one order (allowsDelegation passes only).
 * Committee/portfolio and accommodation are deliberately not offered here —
 * see lib/actions/registration.ts's initiateGroupRegistration header comment
 * for why. Confirming here reuses the exact same `/register/:slug/pay` page
 * solo registration already uses (the payment attaches to the head's own
 * registration id), so there's no separate group checkout screen to build.
 */
export function GroupRegisterPage() {
  const { data: session } = useSession();
  const { slug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const preselectedProductId = searchParams.get("product") ?? undefined;

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

  const delegationProducts = React.useMemo(
    () => (mun?.registrationProducts ?? []).filter((product) => product.allowsDelegation),
    [mun],
  );
  const productIds = delegationProducts.map((product) => product.id);
  const availabilityQuery = useQuery({
    queryKey: queryKeys.productAvailability(productIds),
    queryFn: () => getProductsAvailability(productIds),
    enabled: mun?.status === "REGISTRATION_OPEN" && productIds.length > 0,
  });
  // Fee-inclusive total preview (docs/payments/SPEC.md §4.4/§5 — the amount
  // shown at commit time must match what's actually charged). The server
  // remains authoritative regardless of what this preview shows.
  const feeRatesQuery = useQuery({ queryKey: queryKeys.feeRates(), queryFn: fetchFeeRates, staleTime: 5 * 60 * 1000 });

  const [step, setStep] = React.useState(0);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);
  const errorRef = React.useRef<HTMLDivElement>(null);

  const idempotencyKeyRef = React.useRef<string | null>(null);
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();

  const validPreselected = delegationProducts.some((p) => p.id === preselectedProductId)
    ? preselectedProductId
    : undefined;
  const [productId, setProductId] = React.useState(validPreselected ?? delegationProducts[0]?.id ?? "");
  const [teamSize, setTeamSize] = React.useState(GROUP_MIN_SIZE);
  const [core, setCore] = React.useState({ fullName: "", email: "", phone: "" });
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const coreSeeded = React.useRef(false);

  const account = accountQuery.data;
  const orderedFields = React.useMemo(
    () => [...(mun?.formFields ?? [])].sort((a, b) => a.displayOrder - b.displayOrder),
    [mun],
  );

  // Seed the core/answer fields once account, profile defaults, AND the
  // mun's own form fields have all loaded — same "initial state only" rule
  // register-page.tsx's mount-gate follows. This hook still runs on every
  // render (including the very first, before `mun` exists) since it sits
  // above this component's early returns, so it must wait on every one of
  // these queries itself rather than just `account` — `account` alone can
  // resolve before `mun` does, which previously locked `coreSeeded` with an
  // empty `orderedFields` and left every custom field blank forever.
  const profileDefaultsData = profileDefaultsQuery.data;
  const readyToSeed = Boolean(mun) && !accountQuery.isLoading && !profileDefaultsQuery.isLoading;
  React.useEffect(() => {
    if (coreSeeded.current || !readyToSeed || !account) return;
    coreSeeded.current = true;
    setCore({ fullName: account.name, email: account.email, phone: account.phone ?? "" });
    const defaults = profileDefaultsData ?? {};
    setAnswers(Object.fromEntries(orderedFields.map((f) => [f.fieldKey, defaults[f.fieldKey] ?? ""])));
  }, [account, orderedFields, profileDefaultsData, readyToSeed]);

  if (munQuery.isPending) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-2xl flex-1 px-lg py-xl" aria-busy="true" />
        <SiteFooter />
      </div>
    );
  }
  if (!mun) return <NotFoundPage />;

  const dateRange = formatDateRange(mun.startDate, mun.endDate);
  const location = [mun.city, mun.country].filter(Boolean).join(", ");

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-full flex-1 flex-col">
      <Helmet>
        <title>{`Register a group — ${mun.name} | MUN Hub`}</title>
      </Helmet>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-xl px-lg py-xl sm:px-xl">
        <header className="flex flex-col gap-xs border-b border-border pb-lg">
          <p className="text-caption uppercase text-muted-foreground">Group registration</p>
          <h1 className="font-display text-display-md text-ink text-balance">{mun.name}</h1>
          <p className="text-body-md text-muted-foreground">
            {dateRange}
            {location ? ` · ${location}` : ""}
          </p>
        </header>
        {children}
      </main>
      <SiteFooter />
    </div>
  );

  if (mun.status !== "REGISTRATION_OPEN") {
    return shell(
      <RegistrationNotice tone="neutral" title="Registration isn't open" message={`${mun.name} isn't open for registration right now.`}>
        <Button render={<Link to={`/mun/${slug}`} />}>View conference</Button>
      </RegistrationNotice>,
    );
  }

  if (delegationProducts.length === 0) {
    return shell(
      <RegistrationNotice
        tone="neutral"
        title="No group passes available"
        message="None of this conference's passes currently support group registration."
      >
        <Button render={<Link to={`/register/${slug}`} />}>Register individually</Button>
      </RegistrationNotice>,
    );
  }

  if (availabilityQuery.isPending || profileDefaultsQuery.isLoading || accountQuery.isLoading) {
    return shell(<div aria-busy="true" className="py-xxl" />);
  }

  const availabilityByProduct = availabilityQuery.data ?? {};
  const selectableProducts = delegationProducts
    .map((product) => ({
      product,
      ...(availabilityByProduct[product.id] ?? { capacity: product.capacity, taken: 0, available: product.capacity }),
      deadlinePassed: product.deadline ? hasPassed(product.deadline) : false,
    }))
    .filter((entry) => entry.available >= GROUP_MIN_SIZE && !entry.deadlinePassed);

  if (selectableProducts.length === 0) {
    return shell(
      <RegistrationNotice
        tone="warning"
        title="No group seats left"
        message="Every group-eligible pass is either sold out or doesn't have room for a full team right now."
      >
        <Button render={<Link to={`/register/${slug}`} />}>Register individually</Button>
      </RegistrationNotice>,
    );
  }

  const selected = selectableProducts.find((e) => e.product.id === productId) ?? selectableProducts[0];
  const maxTeamSize = Math.min(GROUP_MAX_SIZE, selected.available);
  const pricing = currentPassPrice(selected.product);
  // The listed price alone — what the organizer is owed, unchanged by the
  // fee (additive model, docs/payments/SPEC.md §0/§4.4). This is NOT what
  // the team is actually charged; see `total` below.
  const passAmount = pricing.price * teamSize;
  const free = passAmount === 0;
  const feePreview = free ? null : previewFeeBreakdownAdditive(passAmount, feeRatesQuery.data);
  // Fee-inclusive total the team will actually be charged. Falls back to the
  // pre-fee amount only while the fee-rates preview hasn't loaded yet — the
  // real charge computed server-side in initiateGroupRegistration is what
  // ultimately matters either way.
  const total = feePreview?.totalCharge ?? passAmount;

  const visibleFields = orderedFields.filter((f) => isFieldVisible(f, answers));
  const detailsComplete =
    core.fullName.trim() !== "" &&
    core.email.trim() !== "" &&
    visibleFields.every((f) => !f.required || (answers[f.fieldKey] ?? "").trim() !== "");

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      const { headRegistrationId, status } = await initiateGroupRegistration(
        {
          munId: mun!.id,
          registrationProductId: selected.product.id,
          teamSize,
          formResponses: {
            ...core,
            ...Object.fromEntries(visibleFields.map((f) => [f.fieldKey, answers[f.fieldKey] ?? ""])),
          },
        },
        idempotencyKeyRef.current!,
      );
      const next = status === "CONFIRMED" ? "confirmation" : "pay";
      navigate(`/register/${slug}/${next}?registrationId=${encodeURIComponent(headRegistrationId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start your team's registration. Try again.");
      setPending(false);
      window.requestAnimationFrame(() => {
        errorRef.current?.focus({ preventScroll: true });
        errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }

  return shell(
    <div className="flex flex-col gap-lg">
      <StepIndicator steps={STEPS} current={step} />

      {step === 0 && (
        <section className="flex flex-col gap-md">
          <div>
            <h2 className="text-title-lg text-ink">How many people, including you?</h2>
            <p className="text-body-md text-muted-foreground">
              You pay for the whole team in one payment now, then invite each teammate by email — nobody else pays separately.
            </p>
          </div>
          {selectableProducts.length > 1 && (
            <div className="flex flex-col gap-xs">
              <Label htmlFor="group-pass">Pass</Label>
              <select
                id="group-pass"
                className={controlClassName}
                value={selected.product.id}
                onChange={(e) => setProductId(e.target.value)}
              >
                {selectableProducts.map((entry) => (
                  <option key={entry.product.id} value={entry.product.id}>
                    {entry.product.name} · {formatPrice(currentPassPrice(entry.product).price)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-xs">
            <Label htmlFor="team-size">Team size</Label>
            <Input
              id="team-size"
              type="number"
              min={GROUP_MIN_SIZE}
              max={maxTeamSize}
              value={teamSize}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isNaN(next)) return;
                setTeamSize(Math.min(maxTeamSize, Math.max(GROUP_MIN_SIZE, Math.round(next))));
              }}
            />
            <p className="text-body-md text-muted-foreground">
              {GROUP_MIN_SIZE} to {maxTeamSize} people ({selected.available} seats left on this pass).
            </p>
          </div>
          <div className="flex flex-col gap-xs rounded-md border border-border bg-surface-soft px-md py-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-label-md text-ink">
                {teamSize} × {formatPrice(pricing.price)}
              </span>
              <span className="font-mono tabular-nums text-ink">{free ? "Free" : formatPrice(passAmount)}</span>
            </div>
            {feePreview && (
              <div className="flex items-baseline justify-between text-body-md text-muted-foreground">
                <span>Platform fee (incl. GST)</span>
                <span className="font-mono tabular-nums">
                  {formatPrice(feePreview.platformFee + feePreview.platformFeeTax)}
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-border pt-xs">
              <span className="text-label-md text-ink">Total</span>
              <span className="font-mono text-title-md tabular-nums text-ink">{free ? "Free" : formatPrice(total)}</span>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={() => setStep(1)}>
              Continue
              <ArrowRightIcon aria-hidden />
            </Button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-md">
          <div>
            <h2 className="text-title-lg text-ink">Your own details</h2>
            <p className="text-body-md text-muted-foreground">
              You're one of the {teamSize} seats — everyone else fills this in themselves once you invite them.
            </p>
          </div>
          <div className="grid gap-md sm:grid-cols-2">
            {CORE_KEYS.map((key) => (
              <div key={key} className="flex flex-col gap-xs">
                <Label htmlFor={key}>
                  {CORE_LABELS[key]}
                  {key !== "phone" && (
                    <span className="text-destructive-text" aria-hidden>
                      *
                    </span>
                  )}
                </Label>
                <Input
                  id={key}
                  type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                  value={core[key]}
                  onChange={(e) => setCore((d) => ({ ...d, [key]: e.target.value }))}
                  aria-invalid={(showErrors && key !== "phone" && !core[key].trim()) || undefined}
                />
                {showErrors && key !== "phone" && !core[key].trim() && (
                  <p className="text-body-md text-destructive-text">{CORE_LABELS[key]} is required.</p>
                )}
              </div>
            ))}
            {visibleFields.map((field) => (
              <DynamicField
                key={field.id}
                field={field}
                value={answers[field.fieldKey] ?? ""}
                onChange={(next) => setAnswers((current) => ({ ...current, [field.fieldKey]: next }))}
                showError={showErrors}
              />
            ))}
          </div>
          <div className="flex justify-between gap-sm">
            <Button type="button" variant="outline" onClick={() => setStep(0)}>
              <ArrowLeftIcon aria-hidden />
              Back
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!detailsComplete) {
                  setShowErrors(true);
                  return;
                }
                setShowErrors(false);
                setStep(2);
              }}
            >
              Review
              <ArrowRightIcon aria-hidden />
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-md">
          <div>
            <h2 className="text-title-lg text-ink">Review and pay for your team</h2>
            <p className="text-body-md text-muted-foreground">
              {free
                ? "This pass is free — confirming books all your team's seats straight away."
                : "Confirming reserves your whole team's seats for 15 minutes while you complete one payment."}
            </p>
          </div>
          <dl className="divide-y divide-border rounded-md border border-border text-body-md">
            <Row label="Conference" value={mun.name} />
            <Row label="Pass" value={selected.product.name} />
            <Row label="Team size" value={`${teamSize} people`} />
            {!free && <Row label="Registration" value={formatPrice(passAmount)} />}
            {feePreview && (
              <Row label="Platform fee (incl. GST)" value={formatPrice(feePreview.platformFee + feePreview.platformFeeTax)} />
            )}
            <Row label="Total" value={free ? "Free" : formatPrice(total)} strong />
            <Row label="Your name" value={core.fullName} />
            <Row label="Your email" value={core.email} />
          </dl>
          <div className="flex items-start gap-xs rounded-sm bg-surface-soft px-md py-sm text-body-md text-muted-foreground">
            <UsersRound className="mt-px size-4 shrink-0" aria-hidden />
            <p>You&apos;ll invite the other {teamSize - 1} teammates by email on the next screen — they don&apos;t pay anything.</p>
          </div>

          {error && (
            <div
              ref={errorRef}
              role="alert"
              tabIndex={-1}
              className={cn(
                "flex flex-col gap-xs rounded-md border border-destructive/30 bg-destructive/8 px-md py-sm text-body-md text-destructive-text outline-none",
              )}
            >
              <p>{error}</p>
            </div>
          )}

          <div className="flex justify-between gap-sm">
            <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={pending}>
              <ArrowLeftIcon aria-hidden />
              Back
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <CheckIcon aria-hidden />}
              {pending ? "Reserving your team's seats…" : free ? "Confirm registration" : "Confirm and pay"}
            </Button>
          </div>
        </section>
      )}
    </div>,
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-md px-md py-sm">
      <dt className={cn("text-muted-foreground", strong && "font-medium text-ink")}>{label}</dt>
      <dd className={cn("text-right text-ink", strong && "font-medium")}>{value}</dd>
    </div>
  );
}
