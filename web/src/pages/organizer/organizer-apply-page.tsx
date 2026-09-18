import * as React from "react";
import { Helmet } from "react-helmet-async";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import {
  listMyOrganizerApplications,
  submitOrganizerApplication,
  type MyOrganizerApplication,
} from "@/api/organizer-application";
import { MAX_EXPECTED_DELEGATES, MIN_DESCRIPTION_LENGTH, getOrganizerOnboarding } from "@/api/organizer-onboarding";
import { queryKeys } from "@/api/query-keys";
import {
  BRIGHT_INPUT_CLASS,
  BRIGHT_PRIMARY_BUTTON_CLASS,
  BRIGHT_TEXTAREA_CLASS,
  BrightField,
  DATE_INPUT_FORMAT,
  WEBSITE_FORMAT,
} from "@/components/organizer/bright-form";
import { OrganizerBrightApplySkeleton } from "@/components/organizer/organizer-bright-skeleton";
import { OrganizerBrightShell } from "@/components/organizer/organizer-bright-shell";
import { RequireOrganizer } from "@/guards/require-organizer";
import { cn } from "cn";

const STATUS_LABELS: Record<MyOrganizerApplication["status"], { label: string; className: string }> = {
  SUBMITTED: { label: "Under review", className: "bg-[#fff4e0] text-[#8a5300]" },
  APPROVED: { label: "Approved", className: "bg-[#e7f6ee] text-[#1f6b3f]" },
  CHANGES_REQUESTED: { label: "Changes requested", className: "bg-[#fdecea] text-[#a3261b]" },
  REJECTED: { label: "Not approved", className: "bg-[#f0f0f3] text-[#5b5b63]" },
};

/**
 * `/organizer/apply` on publish.munhub.in. An organizer's first MUN is applied
 * for inside the onboarding wizard; this page is for every MUN after that.
 * One application can wait for review at a time.
 */
export function OrganizerApplyPage() {
  return (
    <RequireOrganizer>
      <Helmet>
        <title>Host another MUN | MUN Hub</title>
      </Helmet>
      <OrganizerBrightShell menuOpenOnDesktop={false}>
        <ApplyContent />
      </OrganizerBrightShell>
    </RequireOrganizer>
  );
}

function ApplyContent() {
  const { search } = useLocation();
  const onboarding = useQuery({ queryKey: queryKeys.organizerOnboarding(), queryFn: getOrganizerOnboarding });
  const completed = onboarding.data?.completed === true;
  const applications = useQuery({
    queryKey: queryKeys.organizerApplications(),
    queryFn: listMyOrganizerApplications,
    enabled: completed,
  });

  if (onboarding.isPending) return <OrganizerBrightApplySkeleton />;
  // The first MUN is applied for as part of onboarding.
  if (onboarding.data && !completed) return <Navigate to={`/organizer/onboarding${search}`} replace />;
  if (completed && applications.isPending) return <OrganizerBrightApplySkeleton />;

  const mine = applications.data ?? [];
  const pending = mine.find((application) => application.status === "SUBMITTED");

  return (
    <main className="flex-1 px-lg pt-xl pb-28 md:pt-section">
      <div className="mx-auto grid w-full max-w-[1100px] gap-xxl lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>{pending ? <PendingNotice application={pending} /> : <ApplicationForm />}</div>
        <MyApplications applications={mine} />
      </div>
    </main>
  );
}

function PendingNotice({ application }: { application: MyOrganizerApplication }) {
  return (
    <section className="flex flex-col items-start gap-md">
      <span className="flex size-12 items-center justify-center rounded-full bg-[#fff4e0] text-[#8a5300]">
        <Clock3 aria-hidden className="size-6" />
      </span>
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.03em] text-[#121212]">
        {application.munName ?? "Your MUN"} is being reviewed
      </h1>
      <p className="max-w-[560px] text-[15px] text-[#5b5b63]">
        We review every application within 2 business days. You can apply to host another MUN once this one has
        been reviewed.
      </p>
      <Link to="/organizer/dashboard" className={BRIGHT_PRIMARY_BUTTON_CLASS}>
        Go to your dashboard
      </Link>
    </section>
  );
}

function ApplicationForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [city, setCity] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [count, setCount] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [previousEditions, setPreviousEditions] = React.useState("");
  const [websiteUrl, setWebsiteUrl] = React.useState("");
  const [today] = React.useState(() => new Date().toISOString().slice(0, 10));

  const delegates = Number(count);
  const countValid = /^\d+$/.test(count) && delegates >= 1 && delegates <= MAX_EXPECTED_DELEGATES;
  const descriptionLength = description.trim().length;
  const website = websiteUrl.trim();
  const websiteLooksWrong = website.length > 8 && !WEBSITE_FORMAT.test(website);
  const canSubmit =
    Boolean(name.trim() && city.trim()) &&
    DATE_INPUT_FORMAT.test(startDate) &&
    countValid &&
    descriptionLength >= MIN_DESCRIPTION_LENGTH &&
    (website === "" || WEBSITE_FORMAT.test(website));

  const submit = useMutation({
    mutationFn: () =>
      submitOrganizerApplication({
        conferenceName: name.trim(),
        location: city.trim(),
        expectedDate: new Date(`${startDate}T00:00:00.000Z`).toISOString(),
        expectedDelegateCount: delegates,
        description: description.trim(),
        previousEditions: previousEditions.trim() || undefined,
        websiteUrl: website || undefined,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.organizerApplications() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.organizerWorkspace() }),
      ]);
      navigate("/organizer/apply/submitted", { replace: true });
    },
  });
  const error =
    submit.error instanceof Error ? submit.error.message : submit.error ? "Couldn't submit. Try again." : null;

  return (
    <form
      noValidate
      className="flex flex-col gap-lg"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !submit.isPending) submit.mutate();
      }}
    >
      <header className="flex flex-col gap-xs">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.03em] text-[#121212] md:text-[34px]">
          Host another MUN
        </h1>
        <p className="text-[15px] text-[#5b5b63]">
          Tell us about the conference. We review every application within 2 business days.
        </p>
      </header>

      <BrightField id="apply-mun-name" label="Title of your MUN">
        <input
          id="apply-mun-name"
          placeholder="e.g. Hyderabad MUN 2028"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={BRIGHT_INPUT_CLASS}
        />
      </BrightField>
      <div className="grid gap-md sm:grid-cols-2">
        <BrightField id="apply-mun-city" label="Host city">
          <input
            id="apply-mun-city"
            autoComplete="address-level2"
            placeholder="e.g. Hyderabad"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
        <BrightField id="apply-mun-date" label="Expected start date">
          <input
            id="apply-mun-date"
            type="date"
            min={today}
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
      </div>
      <BrightField id="apply-delegates" label="Maximum delegates you expect">
        <input
          id="apply-delegates"
          inputMode="numeric"
          placeholder="e.g. 300"
          value={count}
          onChange={(event) => setCount(event.target.value.replace(/\D/g, "").slice(0, 5))}
          className={cn(BRIGHT_INPUT_CLASS, "max-w-[200px]")}
        />
      </BrightField>
      <BrightField
        id="apply-description"
        label="About your MUN"
        hint={
          descriptionLength < MIN_DESCRIPTION_LENGTH
            ? `At least ${MIN_DESCRIPTION_LENGTH} characters (${descriptionLength} so far)`
            : undefined
        }
      >
        <textarea
          id="apply-description"
          placeholder="Committees, format, who it's for, what makes it different…"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={BRIGHT_TEXTAREA_CLASS}
        />
      </BrightField>
      <div className="grid gap-md sm:grid-cols-2">
        <BrightField id="apply-previous-editions" label="Previous editions (optional)">
          <input
            id="apply-previous-editions"
            placeholder="e.g. 3 editions since 2022"
            value={previousEditions}
            onChange={(event) => setPreviousEditions(event.target.value)}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
        <BrightField id="apply-website" label="Website (optional)">
          <input
            id="apply-website"
            type="url"
            autoComplete="url"
            placeholder="https://"
            value={websiteUrl}
            onChange={(event) => setWebsiteUrl(event.target.value)}
            aria-invalid={websiteLooksWrong ? true : undefined}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
      </div>

      {error || websiteLooksWrong ? (
        <p role="alert" className="text-[14px] text-[#c4320a]">
          {error ?? "Enter the full website address, including https://"}
        </p>
      ) : null}
      <div>
        <button type="submit" className={BRIGHT_PRIMARY_BUTTON_CLASS} disabled={!canSubmit || submit.isPending}>
          {submit.isPending ? "Submitting…" : "Submit application"}
        </button>
      </div>
    </form>
  );
}

function MyApplications({ applications }: { applications: MyOrganizerApplication[] }) {
  if (applications.length === 0) return null;
  return (
    <aside aria-labelledby="my-applications-heading" className="flex flex-col gap-md">
      <h2 id="my-applications-heading" className="text-[18px] font-semibold text-[#121212]">
        Your applications
      </h2>
      <ul className="flex flex-col gap-sm">
        {applications.map((application) => {
          const status = STATUS_LABELS[application.status];
          return (
            <li key={application.id} className="rounded-lg border border-[#e2e2e8] bg-white p-md">
              <div className="flex items-start justify-between gap-sm">
                <p className="text-[15px] font-medium text-[#121212]">{application.munName ?? "Untitled MUN"}</p>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium", status.className)}>
                  {status.label}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-[#8a8a92]">
                Applied {new Date(application.submittedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}
              </p>
              {application.reviewNotes ? (
                <p className="mt-sm rounded-md bg-[#f6f6f8] p-sm text-[13px] whitespace-pre-wrap text-[#3d3d44]">
                  <span className="font-medium text-[#121212]">Note from MUN Hub: </span>
                  {application.reviewNotes}
                </p>
              ) : null}
              {application.munId && application.status === "CHANGES_REQUESTED" ? (
                <Link
                  to={`/organizer/apply/${application.munId}/resubmit`}
                  className="mt-sm inline-block text-[13px] font-medium text-[#121212] underline underline-offset-2"
                >
                  Resubmit application
                </Link>
              ) : null}
              {application.munId && application.status !== "REJECTED" && application.status !== "CHANGES_REQUESTED" ? (
                <Link
                  to={`/organizer/dashboard/${application.munId}/setup`}
                  className="mt-sm inline-block text-[13px] font-medium text-[#121212] underline underline-offset-2"
                >
                  Open in dashboard
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
