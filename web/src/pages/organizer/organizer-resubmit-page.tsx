import * as React from "react";
import { Helmet } from "react-helmet-async";
import { Navigate, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon } from "lucide-react";
import {
  listMyOrganizerApplications,
  resubmitOrganizerApplication,
  type MyOrganizerApplication,
} from "@/api/organizer-application";
import { MAX_EXPECTED_DELEGATES, MIN_DESCRIPTION_LENGTH } from "@/api/organizer-onboarding";
import { queryKeys } from "@/api/query-keys";
import {
  BRIGHT_INPUT_CLASS,
  BRIGHT_PRIMARY_BUTTON_CLASS,
  BRIGHT_TEXTAREA_CLASS,
  BrightField,
  DATE_INPUT_FORMAT,
  WEBSITE_FORMAT,
} from "@/components/organizer/bright-form";
import { OrganizerBrightFormSkeleton } from "@/components/organizer/organizer-bright-skeleton";
import { OrganizerBrightShell } from "@/components/organizer/organizer-bright-shell";
import { RequireOrganizer } from "@/guards/require-organizer";
import type { ApplicationFieldKey } from "@/lib/organizer-application-fields";
import { cn } from "cn";

/**
 * `/organizer/apply/:munId/resubmit` — the Gate-1 loop. Reached from
 * organizer-apply-page.tsx's "Resubmit application" link, only shown for a
 * CHANGES_REQUESTED application. Lets the organizer see the reviewer's note
 * and edit their answers before putting the mun back in the review queue
 * (POST /organizer/applications/:munId/resubmit).
 */
export function OrganizerResubmitPage() {
  return (
    <RequireOrganizer>
      <Helmet>
        <title>Resubmit your application | MUN Hub</title>
      </Helmet>
      <OrganizerBrightShell menuOpenOnDesktop={false}>
        <ResubmitContent />
      </OrganizerBrightShell>
    </RequireOrganizer>
  );
}

function ResubmitContent() {
  const { munId = "" } = useParams();
  const applications = useQuery({ queryKey: queryKeys.organizerApplications(), queryFn: listMyOrganizerApplications });

  if (applications.isPending) return <OrganizerBrightFormSkeleton />;

  const application = (applications.data ?? []).find((a) => a.munId === munId);
  // Nothing to resubmit here: either it's not this organizer's application,
  // or MUN Hub hasn't (or no longer has) requested changes on it. Send them
  // back to the list rather than showing a dead form.
  if (!application || application.status !== "CHANGES_REQUESTED") {
    return <Navigate to="/organizer/apply" replace />;
  }

  return <ResubmitForm application={application} />;
}

function ResubmitForm({ application }: { application: MyOrganizerApplication }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(application.munName ?? "");
  const [city, setCity] = React.useState(application.munCity ?? "");
  const [startDate, setStartDate] = React.useState(application.munStartDate?.slice(0, 10) ?? "");
  const [count, setCount] = React.useState(
    application.expectedDelegateCount != null ? String(application.expectedDelegateCount) : "",
  );
  const [description, setDescription] = React.useState(application.munDescription ?? "");
  const [previousEditions, setPreviousEditions] = React.useState(application.previousEditions ?? "");
  const [websiteUrl, setWebsiteUrl] = React.useState(application.websiteUrl ?? "");
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

  const resubmit = useMutation({
    mutationFn: () =>
      resubmitOrganizerApplication(application.munId!, {
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
    resubmit.error instanceof Error ? resubmit.error.message : resubmit.error ? "Couldn't resubmit. Try again." : null;

  const flagged = new Set<ApplicationFieldKey>(application.fieldsRequiringCorrection as ApplicationFieldKey[]);
  /** Appends a "needs correction" suffix to a field label when the reviewer flagged it. */
  const fieldLabel = (base: string, key: ApplicationFieldKey) => (flagged.has(key) ? `${base} — needs correction` : base);

  return (
    <main className="flex-1 px-lg pt-xl pb-28 md:pt-section">
      <form
        noValidate
        className="mx-auto flex w-full max-w-[640px] flex-col gap-lg"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !resubmit.isPending) resubmit.mutate();
        }}
      >
        <header className="flex flex-col gap-xs">
          <h1 className="text-[30px] leading-tight font-bold tracking-[-0.03em] text-[#121212] md:text-[34px]">
            Resubmit your application
          </h1>
          <p className="text-[15px] text-[#5b5b63]">
            Update the answers below and resubmit — we review every resubmission within 2 business days.
          </p>
        </header>

        {application.reviewNotes ? (
          <div className="flex gap-sm rounded-lg border border-[#f3d9a8] bg-[#fff8ea] p-md">
            <AlertTriangleIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-[#8a5300]" />
            <div className="flex flex-col gap-1">
              <p className="text-[13px] font-medium text-[#8a5300]">Changes requested by MUN Hub</p>
              <p className="text-[14px] whitespace-pre-wrap text-[#3d3d44]">{application.reviewNotes}</p>
            </div>
          </div>
        ) : null}

        <BrightField id="resubmit-mun-name" label={fieldLabel("Title of your MUN", "conferenceName")}>
          <input
            id="resubmit-mun-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={BRIGHT_INPUT_CLASS}
          />
        </BrightField>
        <div className="grid gap-md sm:grid-cols-2">
          <BrightField id="resubmit-mun-city" label={fieldLabel("Host city", "location")}>
            <input
              id="resubmit-mun-city"
              autoComplete="address-level2"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className={BRIGHT_INPUT_CLASS}
            />
          </BrightField>
          <BrightField id="resubmit-mun-date" label={fieldLabel("Expected start date", "expectedDate")}>
            <input
              id="resubmit-mun-date"
              type="date"
              min={today}
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className={BRIGHT_INPUT_CLASS}
            />
          </BrightField>
        </div>
        <BrightField id="resubmit-delegates" label={fieldLabel("Maximum delegates you expect", "expectedDelegateCount")}>
          <input
            id="resubmit-delegates"
            inputMode="numeric"
            value={count}
            onChange={(event) => setCount(event.target.value.replace(/\D/g, "").slice(0, 5))}
            className={cn(BRIGHT_INPUT_CLASS, "max-w-[200px]")}
          />
        </BrightField>
        <BrightField
          id="resubmit-description"
          label={fieldLabel("About your MUN", "description")}
          hint={
            descriptionLength < MIN_DESCRIPTION_LENGTH
              ? `At least ${MIN_DESCRIPTION_LENGTH} characters (${descriptionLength} so far)`
              : undefined
          }
        >
          <textarea
            id="resubmit-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={BRIGHT_TEXTAREA_CLASS}
          />
        </BrightField>
        <div className="grid gap-md sm:grid-cols-2">
          <BrightField
            id="resubmit-previous-editions"
            label={fieldLabel("Previous editions (optional)", "previousEditions")}
          >
            <input
              id="resubmit-previous-editions"
              value={previousEditions}
              onChange={(event) => setPreviousEditions(event.target.value)}
              className={BRIGHT_INPUT_CLASS}
            />
          </BrightField>
          <BrightField id="resubmit-website" label={fieldLabel("Website (optional)", "websiteUrl")}>
            <input
              id="resubmit-website"
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
          <button type="submit" className={BRIGHT_PRIMARY_BUTTON_CLASS} disabled={!canSubmit || resubmit.isPending}>
            {resubmit.isPending ? "Resubmitting…" : "Resubmit application"}
          </button>
        </div>
      </form>
    </main>
  );
}
