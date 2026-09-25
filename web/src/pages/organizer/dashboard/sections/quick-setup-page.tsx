import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { CheckCircle2, Send, Wallet } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { createCommittee } from "@/api/committees";
import { getMunProgress, submitMunForReview } from "@/api/go-live";
import { getMunDetails, updateMunDetails } from "@/api/mun-config";
import { getOrganizerOnboarding } from "@/api/organizer-onboarding";
import { createRegistrationProduct } from "@/api/registration-products";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { munSectionHref } from "@/lib/organizer/nav-config";
import type { MunSetupDetails } from "@/types/mun-config";

interface QuickSetupForm {
  name: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string;
  registrationOpensAt: string;
  registrationDeadline: string;
  committeeName: string;
  committeeCapacity: string;
  ticketName: string;
  ticketPrice: string;
  ticketCapacity: string;
}

const EMPTY_FORM: QuickSetupForm = {
  name: "",
  startDate: "",
  endDate: "",
  city: "",
  country: "",
  registrationOpensAt: "",
  registrationDeadline: "",
  committeeName: "",
  committeeCapacity: "",
  ticketName: "General delegate",
  ticketPrice: "",
  ticketCapacity: "",
};

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function toDateTimeInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeInputValue(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function formFromMun(mun: MunSetupDetails): QuickSetupForm {
  return {
    ...EMPTY_FORM,
    name: mun.name,
    startDate: toDateInputValue(mun.startDate),
    endDate: toDateInputValue(mun.endDate),
    city: mun.city ?? "",
    country: mun.country ?? "",
    registrationOpensAt: toDateTimeInputValue(mun.registrationOpensAt),
    registrationDeadline: toDateTimeInputValue(mun.registrationDeadline),
  };
}

// Mirrors mun-index-redirect.tsx's PRE_SUBMISSION_STATUSES / setup-page.tsx's
// SUBMITTABLE_STATUSES. Quick Setup is the minimum-fields form for a MUN that
// hasn't been submitted yet — once it has (or is already live), the "Submit
// for review" call here would just be rejected server-side as an illegal
// transition, so this page should point the organizer at MUN Setup instead.
const SUBMITTABLE_STATUSES = ["ONBOARDING", "ACTION_REQUIRED", "READY_FOR_SUBMISSION", "CONTENT_SUBMITTED"];

function validate(form: QuickSetupForm, hasCommittee: boolean, hasTicket: boolean): string | null {
  if (!form.name.trim()) return "Conference name is required";
  if (!form.startDate || !form.endDate) return "Start and end dates are required";
  if (form.endDate < form.startDate) return "End date can't be before the start date";
  if (!form.city.trim()) return "City is required";
  const opens = form.registrationOpensAt ? new Date(form.registrationOpensAt).getTime() : null;
  const closes = form.registrationDeadline ? new Date(form.registrationDeadline).getTime() : null;
  if (!closes) return "Registration deadline is required";
  if (closes >= new Date(`${form.startDate}T00:00`).getTime()) {
    return "Registration deadline must be before the conference starts";
  }
  if (opens !== null && closes <= opens) return "Registration deadline must be after registration opens";
  if (!hasCommittee) {
    if (!form.committeeName.trim()) return "Committee name is required";
    if (!form.committeeCapacity.trim() || Number(form.committeeCapacity) <= 0) {
      return "Committee capacity must be a positive number";
    }
  }
  if (!hasTicket) {
    if (!form.ticketName.trim()) return "Registration type name is required";
    if (form.ticketPrice.trim() === "" || Number(form.ticketPrice) < 0) {
      return "Pass price must be zero or more";
    }
    if (!form.ticketCapacity.trim() || Number(form.ticketCapacity) <= 0) {
      return "Pass capacity must be a positive number";
    }
  }
  return null;
}

/**
 * One page bundling every field required to submit a MUN for MUN Hub review
 * (name, dates, location, at least one committee, at least one paid
 * registration type, and an account-level payment payout link) — the
 * minimum-required-fields cut of the go-live pipeline. Everything else
 * (branding, portfolios, executive board, rules/documents, schedule,
 * accommodation) stays optional and lives on its own page; this page exists
 * so an organizer doesn't have to visit four separate sections just to hit
 * the minimum before submitting.
 */
export function OrganizerQuickSetupPage() {
  const { munId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<QuickSetupForm>(EMPTY_FORM);

  const detailsQuery = useQuery({
    queryKey: queryKeys.munSetupDetails(munId),
    queryFn: () => getMunDetails(munId),
    enabled: Boolean(munId),
  });
  const progressQuery = useQuery({
    queryKey: queryKeys.munProgress(munId),
    queryFn: () => getMunProgress(munId),
    enabled: Boolean(munId),
  });
  const onboardingQuery = useQuery({
    queryKey: queryKeys.organizerOnboarding(),
    queryFn: getOrganizerOnboarding,
  });

  useEffect(() => {
    if (detailsQuery.data) setForm((current) => ({ ...current, ...formFromMun(detailsQuery.data) }));
  }, [detailsQuery.data]);

  const set = (field: keyof QuickSetupForm) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const modules = progressQuery.data?.modules ?? [];
  const moduleComplete = (key: string) => modules.find((m) => m.key === key)?.completionStatus === "COMPLETE";
  const hasCommittee = moduleComplete("COMMITTEES");
  const hasTicket = moduleComplete("REGISTRATION_TYPES") && moduleComplete("PRICING_CAPACITY");
  // Bank details are the required payout method (2026-09-26); UPI is optional.
  const paymentLinked = Boolean(onboardingQuery.data?.profile.bankAccountLast4);
  const status = progressQuery.data?.lifecycleStatus ?? detailsQuery.data?.status;
  const canSubmit = Boolean(status && SUBMITTABLE_STATUSES.includes(status));

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.munSetupDetails(munId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.munProgress(munId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.organizerWorkspace() }),
    ]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      await updateMunDetails(munId, {
        name: form.name.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        city: form.city.trim(),
        country: form.country.trim() || null,
        registrationOpensAt: fromDateTimeInputValue(form.registrationOpensAt),
        registrationDeadline: fromDateTimeInputValue(form.registrationDeadline),
      });
      if (!hasCommittee) {
        await createCommittee(munId, {
          name: form.committeeName.trim(),
          agenda: "",
          description: "",
          capacity: Number(form.committeeCapacity),
        });
      }
      if (!hasTicket) {
        await createRegistrationProduct(munId, {
          name: form.ticketName.trim(),
          price: Number(form.ticketPrice),
          capacity: Number(form.ticketCapacity),
        });
      }
      return submitMunForReview(munId);
    },
    onSuccess: async (result) => {
      await refresh();
      if (result.passed) {
        toast.success("Submitted for MUN Hub review");
        navigate(munSectionHref(munId, "setup"));
      } else {
        toast.error(`${result.blockers.length} thing(s) still need fixing`);
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to submit for review"),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!paymentLinked) {
      toast.error("Add your bank account payout details from Settings before submitting");
      return;
    }
    const problem = validate(form, hasCommittee, hasTicket);
    if (problem) {
      toast.error(problem);
      return;
    }
    submitMutation.mutate();
  };

  const loading = detailsQuery.isLoading || progressQuery.isLoading;

  return (
    <>
      <Helmet title="Quick Setup" />
      <WorkspacePage
        title="Quick setup"
        description="The minimum MUN Hub needs to review and publish your conference. Everything else can be filled in any time."
      >
        {loading ? (
          <Skeleton className="h-[520px] w-full max-w-2xl rounded-md" />
        ) : detailsQuery.isError ? (
          <p className="text-body-md text-destructive">{detailsQuery.error.message}</p>
        ) : !canSubmit ? (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Quick setup is already done</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-md">
              <p className="text-body-md text-muted-foreground">
                {detailsQuery.data?.name ?? "This conference"} has already been submitted to MUN Hub, so there's
                nothing left to submit here. Manage its details and go-live status from MUN Setup instead.
              </p>
              <div>
                <Button size="sm" render={<Link to={munSectionHref(munId, "setup")} />}>
                  Go to MUN Setup
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Required details</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-lg" onSubmit={handleSubmit}>
                <fieldset className="flex flex-col gap-md">
                  <legend className="font-display text-body-md font-medium text-ink">Conference</legend>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="qs-name">Conference name</Label>
                    <Input id="qs-name" value={form.name} onChange={set("name")} required />
                  </div>
                  <div className="grid gap-md sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="qs-start">Start date</Label>
                      <Input id="qs-start" type="date" value={form.startDate} onChange={set("startDate")} required />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="qs-end">End date</Label>
                      <Input id="qs-end" type="date" value={form.endDate} onChange={set("endDate")} required />
                    </div>
                  </div>
                  <div className="grid gap-md sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="qs-city">City</Label>
                      <Input id="qs-city" autoComplete="address-level2" value={form.city} onChange={set("city")} required />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="qs-country">Country</Label>
                      <Input id="qs-country" autoComplete="country-name" value={form.country} onChange={set("country")} />
                    </div>
                  </div>
                  <div className="grid gap-md sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="qs-opens">Registration opens</Label>
                      <Input
                        id="qs-opens"
                        type="datetime-local"
                        value={form.registrationOpensAt}
                        onChange={set("registrationOpensAt")}
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="qs-deadline">Registration closes</Label>
                      <Input
                        id="qs-deadline"
                        type="datetime-local"
                        value={form.registrationDeadline}
                        onChange={set("registrationDeadline")}
                        required
                      />
                    </div>
                  </div>
                </fieldset>

                <fieldset className="flex flex-col gap-md border-t border-border pt-md">
                  <legend className="font-display text-body-md font-medium text-ink">Committee</legend>
                  {hasCommittee ? (
                    <StepDone label="At least one committee is already set up." href={munSectionHref(munId, "committees")} />
                  ) : (
                    <div className="grid gap-md sm:grid-cols-2">
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="qs-committee-name">Committee name</Label>
                        <Input
                          id="qs-committee-name"
                          placeholder="e.g. UNSC"
                          value={form.committeeName}
                          onChange={set("committeeName")}
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="qs-committee-capacity">Capacity</Label>
                        <Input
                          id="qs-committee-capacity"
                          type="number"
                          min="1"
                          value={form.committeeCapacity}
                          onChange={set("committeeCapacity")}
                          required
                        />
                      </div>
                    </div>
                  )}
                </fieldset>

                <fieldset className="flex flex-col gap-md border-t border-border pt-md">
                  <legend className="font-display text-body-md font-medium text-ink">Pass / registration type</legend>
                  {hasTicket ? (
                    <StepDone
                      label="At least one registration type is already priced."
                      href={munSectionHref(munId, "products")}
                    />
                  ) : (
                    <div className="grid gap-md sm:grid-cols-3">
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="qs-ticket-name">Pass name</Label>
                        <Input id="qs-ticket-name" value={form.ticketName} onChange={set("ticketName")} required />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="qs-ticket-price">Price (₹)</Label>
                        <Input
                          id="qs-ticket-price"
                          type="number"
                          min="0"
                          value={form.ticketPrice}
                          onChange={set("ticketPrice")}
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="qs-ticket-capacity">Capacity</Label>
                        <Input
                          id="qs-ticket-capacity"
                          type="number"
                          min="1"
                          value={form.ticketCapacity}
                          onChange={set("ticketCapacity")}
                          required
                        />
                      </div>
                    </div>
                  )}
                </fieldset>

                <fieldset className="flex flex-col gap-md border-t border-border pt-md">
                  <legend className="font-display text-body-md font-medium text-ink">Payment</legend>
                  {paymentLinked ? (
                    <StepDone label="Your bank account payout details are on file." />
                  ) : (
                    <div className="flex items-center gap-sm rounded-md border border-warning/40 bg-warning/10 px-md py-sm">
                      <Wallet className="size-4 shrink-0 text-warning-text" aria-hidden />
                      <p className="text-body-md text-ink">
                        Add your bank account payout details from{" "}
                        <Link to={munSectionHref(munId, "settings")} className="font-medium text-link underline-offset-2 hover:underline">
                          Settings
                        </Link>{" "}
                        before submitting.
                      </p>
                    </div>
                  )}
                </fieldset>

                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={submitMutation.isPending}>
                    <Send aria-hidden />
                    {submitMutation.isPending ? "Submitting..." : "Submit for review"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </WorkspacePage>
    </>
  );
}

function StepDone({ label, href }: { label: string; href?: string }) {
  return (
    <div className="flex items-center gap-sm rounded-md border border-success/40 bg-success/10 px-md py-sm">
      <CheckCircle2 className="size-4 shrink-0 text-success-text" aria-hidden />
      <p className="text-body-md text-ink">
        {label}
        {href && (
          <>
            {" "}
            <Link to={href} className="font-medium text-link underline-offset-2 hover:underline">
              Edit
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
