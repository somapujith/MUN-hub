import * as React from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router";
import { ArrowRightIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { RequireOrganizer } from "@/guards/require-organizer";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";
import { submitOrganizerApplication } from "@/api/organizer-application";

const STEPS = [
  "Submit this application",
  "Our team reviews it within 5 business days",
  "Build out committees, portfolios and pricing",
  "Go live and open registration",
];

const textareaClassName = cn(
  "min-h-28 w-full resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink transition-colors outline-none",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-surface-soft disabled:text-muted-foreground",
  "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
  "dark:bg-card",
);

interface FormValues {
  conferenceName: string;
  location: string;
  expectedDate: string;
  expectedDelegateCount: string;
  description: string;
  previousEditions: string;
  websiteUrl: string;
}

const EMPTY_VALUES: FormValues = {
  conferenceName: "",
  location: "",
  expectedDate: "",
  expectedDelegateCount: "",
  description: "",
  previousEditions: "",
  websiteUrl: "",
};

function validate(values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!values.conferenceName.trim()) errors.conferenceName = "Enter the name of your conference.";
  if (!values.location.trim()) errors.location = "Enter the host city.";

  const expectedDate = values.expectedDate ? new Date(values.expectedDate) : null;
  if (!expectedDate || Number.isNaN(expectedDate.getTime())) {
    errors.expectedDate = "Choose an expected start date.";
  }

  const delegateCount = Number(values.expectedDelegateCount);
  if (
    !values.expectedDelegateCount ||
    !Number.isFinite(delegateCount) ||
    !Number.isInteger(delegateCount) ||
    delegateCount < 1
  ) {
    errors.expectedDelegateCount = "Enter a whole number of delegates (1 or more).";
  }

  if (values.description.trim().length < 40) {
    errors.description = "Tell us a bit more — at least 40 characters about your conference.";
  }

  if (values.websiteUrl.trim()) {
    try {
      const parsed = new URL(values.websiteUrl.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
    } catch {
      errors.websiteUrl = "Enter a full URL, including https://";
    }
  }

  return errors;
}

export function OrganizerApplyPage() {
  const navigate = useNavigate();
  const [values, setValues] = React.useState<FormValues>(EMPTY_VALUES);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const update = (field: keyof FormValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const fieldErrors = validate(values);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitOrganizerApplication({
        conferenceName: values.conferenceName.trim(),
        location: values.location.trim(),
        expectedDate: new Date(values.expectedDate).toISOString(),
        expectedDelegateCount: Number(values.expectedDelegateCount),
        description: values.description.trim(),
        previousEditions: values.previousEditions.trim() || undefined,
        websiteUrl: values.websiteUrl.trim() || undefined,
      });
      navigate("/organizer/apply/submitted");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RequireOrganizer>
      <Helmet title="Host a MUN" />
      <div className="flex min-h-full flex-1 flex-col">
        <SiteHeader />
        <main className="flex-1 pb-section">
          <div className="content-container">
            <div className="grid gap-xl py-xxl lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-section lg:py-section">
              <div className="flex max-w-2xl flex-col gap-xl">
                <header className="flex flex-col gap-md">
                  <p className="text-caption text-muted-foreground">For organizers</p>
                  <h1 className="font-display text-display-md text-balance text-ink lg:text-display-lg">
                    Host your MUN on MUN Hub
                  </h1>
                  <p className="text-title-md text-body text-pretty dark:text-muted-foreground">
                    Tell us about your conference. Once approved, you&apos;ll get a public listing,
                    a delegate roster, and payments handled end to end.
                  </p>
                </header>
                <form onSubmit={handleSubmit} className="flex flex-col gap-md rounded-md border border-border bg-card p-lg">
                  {submitError && (
                    <p role="alert" className="flex items-start gap-xs rounded-sm border border-destructive/30 bg-destructive/8 px-sm py-xs text-body-md text-destructive-text">
                      <TriangleAlertIcon className="mt-px size-4 shrink-0" aria-hidden />
                      <span>{submitError}</span>
                    </p>
                  )}

                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="conferenceName">Conference name</Label>
                    <Input id="conferenceName" placeholder="Hyderabad MUN 2026" value={values.conferenceName} onChange={update("conferenceName")} aria-invalid={Boolean(errors.conferenceName)} required />
                    {errors.conferenceName && <p className="text-body-md text-destructive-text">{errors.conferenceName}</p>}
                  </div>

                  <div className="grid gap-md sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="location">Host city</Label>
                      <Input id="location" placeholder="Hyderabad" value={values.location} onChange={update("location")} aria-invalid={Boolean(errors.location)} required />
                      {errors.location && <p className="text-body-md text-destructive-text">{errors.location}</p>}
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="expectedDate">Expected start date</Label>
                      <Input id="expectedDate" type="date" value={values.expectedDate} onChange={update("expectedDate")} aria-invalid={Boolean(errors.expectedDate)} required />
                      {errors.expectedDate && <p className="text-body-md text-destructive-text">{errors.expectedDate}</p>}
                    </div>
                  </div>

                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="expectedDelegateCount">Expected delegate count</Label>
                    <Input id="expectedDelegateCount" type="number" min="1" step="1" placeholder="200" value={values.expectedDelegateCount} onChange={update("expectedDelegateCount")} aria-invalid={Boolean(errors.expectedDelegateCount)} required />
                    {errors.expectedDelegateCount && <p className="text-body-md text-destructive-text">{errors.expectedDelegateCount}</p>}
                  </div>

                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="description">Tell us about your conference</Label>
                    <textarea id="description" className={textareaClassName} placeholder="Committees, theme, past editions, why delegates should come..." value={values.description} onChange={update("description")} aria-invalid={Boolean(errors.description)} required />
                    {errors.description && <p className="text-body-md text-destructive-text">{errors.description}</p>}
                  </div>

                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="previousEditions">Previous editions (optional)</Label>
                    <textarea id="previousEditions" className={textareaClassName} placeholder="e.g. 3rd edition, 400 delegates last year" value={values.previousEditions} onChange={update("previousEditions")} />
                  </div>

                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="websiteUrl">Website (optional)</Label>
                    <Input id="websiteUrl" type="url" placeholder="https://..." value={values.websiteUrl} onChange={update("websiteUrl")} aria-invalid={Boolean(errors.websiteUrl)} />
                    {errors.websiteUrl && <p className="text-body-md text-destructive-text">{errors.websiteUrl}</p>}
                  </div>

                  <Button type="submit" disabled={submitting}>
                    {submitting ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                    {submitting ? "Submitting…" : "Submit application"}
                  </Button>
                </form>
              </div>
              <aside>
                <div className="flex flex-col gap-md rounded-md border border-border bg-surface-soft p-lg lg:sticky lg:top-24 dark:bg-card">
                  <h2 className="font-display text-label-md text-ink">What happens next</h2>
                  <ol className="flex flex-col gap-sm">
                    {STEPS.map((step, index) => (
                      <li key={step} className="flex items-start gap-sm text-body-md text-body dark:text-muted-foreground">
                        <span aria-hidden className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-legal tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="text-pretty">{step}</span>
                      </li>
                    ))}
                  </ol>
                  <Button variant="outline" size="sm" render={<Link to="/muns" />}>
                    Browse conferences
                    <ArrowRightIcon aria-hidden strokeWidth={1.75} />
                  </Button>
                </div>
              </aside>
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    </RequireOrganizer>
  );
}
