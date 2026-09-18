import * as React from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  BuildingIcon,
  CheckIcon,
  CopyIcon,
  LinkIcon,
  Loader2Icon,
  MapPinIcon,
  RotateCcwIcon,
  SendIcon,
} from "lucide-react";
import { submitContactForm } from "@/api/contact-form";
import { InfoPageShell, InfoSection, PageHero } from "@/components/content/info-page";
import { RegisteredBusinessDetails } from "@/components/content/registered-business-details";
import { REQUESTER_CATEGORY_OPTIONS } from "@/components/support/support-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SITE_INFO } from "@/lib/site-info";
import type { RequesterCategory } from "@/types/support";
import { SUPPORT_LIMITS } from "@/types/support";

const QUICK_ANSWERS = [
  {
    question: "I paid, but my registration still says payment pending.",
    answer: (
      <>
        We confirm a registration once we've verified the payment, which
        usually takes a few minutes. If it still says pending after that,
        open a ticket with the conference name and we'll check it for you.
      </>
    ),
  },
  {
    question: "My seat hold expired while I was paying.",
    answer: (
      <>
        A seat is held for 15 minutes. If money left your account after the
        hold expired, no registration was created, so we return the full
        amount. See{" "}
        <Link to="/legal/refunds#failed-and-late-payments">payment errors</Link>.
      </>
    ),
  },
  {
    question: "Can I get a refund if I can't attend?",
    answer: (
      <>
        No. Once a registration is paid and confirmed, it's final, even if
        your plans change or the conference changes. Please check the details
        before you pay. See our <Link to="/legal/refunds">Refund policy</Link>.
      </>
    ),
  },
  {
    question: "I have a question about a committee, agenda, or the conference schedule.",
    answer: (
      <>
        Start with the conference page, which lists its committees and
        passes. If it doesn't answer your question, write in under “MUN
        info” and we'll help you get an answer from the organizer.
      </>
    ),
  },
  {
    question: "I forgot my password.",
    answer: (
      <>
        Reset it from the <Link to="/forgot-password">forgot password</Link>{" "}
        page. We'll email you a link that works for one hour.
      </>
    ),
  },
];

export function ContactPage() {
  return (
    <InfoPageShell
      title="Contact"
      description="Get help with a MUN Hub registration or payment, list your Model UN conference, report a listing, or make a privacy request."
    >
      <PageHero
        eyebrow="Contact"
        title="How can we help?"
        lede="Write to us below and our team will get back to you by email."
        image="/images/contact-hero.jpg"
      />

      <div className="content-container flex flex-col gap-section py-xxl md:py-section">
        <div className="grid gap-xl lg:grid-cols-[1.6fr_1fr] lg:gap-xxl">
          <div>
            <SectionHeading>Write to us by filling in the form below</SectionHeading>
            <div className="mt-lg">
              <ContactForm />
            </div>
          </div>

          <div>
            <SectionHeading>Contact us</SectionHeading>
            <div className="mt-lg">
              <ContactInfoCard />
            </div>
          </div>
        </div>

        <InfoSection
          eyebrow="Before you write in"
          title="Quick answers"
          intro="Some questions we can answer right here."
        >
          <dl className="grid max-w-5xl gap-x-xl gap-y-lg md:grid-cols-2">
            {QUICK_ANSWERS.map((item) => (
              <div key={item.question} className="border-t border-border pt-md">
                <dt className="font-display text-title-sm font-medium text-ink">{item.question}</dt>
                <dd className="mt-xs text-base leading-7 text-body dark:text-muted-foreground [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4">
                  {item.answer}
                </dd>
              </div>
            ))}
          </dl>
        </InfoSection>

        <InfoSection eyebrow="Registered business" title="Full registered details" id="registered-business">
          <RegisteredBusinessDetails />
        </InfoSection>

        <InfoSection
          eyebrow="Good to know"
          title="MUN Hub doesn't run the conferences we list"
          intro={
            <>
              Each conference is organized and delivered by its own
              secretariat. We handle discovery, registration, payments, and
              review of every listing. Questions about what happens at the
              conference itself are best sent to the organizer. See our{" "}
              <Link to="/legal/terms" className="text-link underline underline-offset-4">
                Terms of service
              </Link>{" "}
              for how responsibilities are split.
            </>
          }
        />
      </div>
    </InfoPageShell>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <div>
      <h2 className="font-display text-title-lg font-normal text-ink">{children}</h2>
      <span aria-hidden className="mt-xs block h-0.5 w-8 bg-signature-coral" />
    </div>
  );
}

const EMPTY_FORM = { category: "GENERAL" as RequesterCategory, name: "", email: "", phone: "", message: "" };

function ContactForm() {
  const [form, setForm] = React.useState(EMPTY_FORM);
  // Honeypot — never rendered visibly (see server/routes/contact.ts).
  const [website, setWebsite] = React.useState("");

  const submitMutation = useMutation({
    mutationFn: () =>
      submitContactForm({
        category: form.category,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        message: form.message.trim() || undefined,
        website: website || undefined,
      }),
    onSuccess: () => {
      toast.success("Message sent. We'll get back to you by email.");
      setForm(EMPTY_FORM);
    },
  });

  const pending = submitMutation.isPending;
  const canSubmit = form.name.trim().length > 0 && form.email.trim().length > 0 && form.phone.trim().length > 0;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || pending) return;
    submitMutation.mutate();
  }

  function handleReset() {
    setForm(EMPTY_FORM);
    submitMutation.reset();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-md" noValidate>
      <div className="flex flex-col gap-xs">
        <Label htmlFor="contact-category">Category</Label>
        <select
          id="contact-category"
          className="h-11 w-full rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:bg-surface-soft dark:bg-card"
          value={form.category}
          onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value as RequesterCategory }))}
          disabled={pending}
        >
          {REQUESTER_CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-xs">
        <Label htmlFor="contact-name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="contact-name"
          autoComplete="name"
          placeholder="Please enter your name"
          value={form.name}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          maxLength={100}
          required
          disabled={pending}
        />
      </div>

      <div className="grid gap-md sm:grid-cols-2">
        <div className="flex flex-col gap-xs">
          <Label htmlFor="contact-email">
            Email <span className="text-destructive">*</span>
          </Label>
          <Input
            id="contact-email"
            type="email"
            autoComplete="email"
            placeholder="Please enter your email"
            value={form.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            required
            disabled={pending}
          />
        </div>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="contact-phone">
            Mobile number <span className="text-destructive">*</span>
          </Label>
          <Input
            id="contact-phone"
            type="tel"
            autoComplete="tel"
            placeholder="eg: 91XXXXXXXXXX"
            value={form.phone}
            onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
            maxLength={20}
            required
            disabled={pending}
          />
        </div>
      </div>

      <div className="flex flex-col gap-xs">
        <Label htmlFor="contact-message">Message</Label>
        <textarea
          id="contact-message"
          rows={5}
          className="w-full resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:bg-surface-soft dark:bg-card"
          placeholder="Type message here"
          value={form.message}
          onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
          maxLength={SUPPORT_LIMITS.body}
          disabled={pending}
        />
      </div>

      {/* Honeypot: real visitors never see or fill this in. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="contact-website">Leave this field blank</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      {submitMutation.isError && (
        <p
          role="alert"
          className="flex items-start gap-xs rounded-sm border border-destructive/30 bg-destructive/10 px-sm py-xs text-body-md text-destructive-text"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {submitMutation.error.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-sm">
        <Button type="button" variant="outline" onClick={handleReset} disabled={pending}>
          <RotateCcwIcon aria-hidden />
          Reset
        </Button>
        <Button type="submit" disabled={pending || !canSubmit}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
          {pending ? "Sending…" : "Submit"}
        </Button>
      </div>
    </form>
  );
}

function CopyableRow({
  icon: Icon,
  children,
  copyValue,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
  copyValue?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select the text instead.");
    }
  }

  return (
    <div className="flex items-start gap-sm border-b border-border py-md last:border-b-0">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 text-body-md leading-relaxed text-ink">{children}</div>
      {copyValue && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy"
          className="shrink-0 rounded-sm p-xxs text-muted-foreground transition-colors duration-150 hover:bg-surface-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {copied ? <CheckIcon className="size-4" aria-hidden /> : <CopyIcon className="size-4" aria-hidden />}
        </button>
      )}
    </div>
  );
}

function ContactInfoCard() {
  const website = `https://${SITE_INFO.domain}`;
  return (
    <div className="rounded-lg border border-border p-lg">
      <CopyableRow icon={MapPinIcon}>
        {SITE_INFO.legalName}
        <br />
        {SITE_INFO.address.line1}, {SITE_INFO.address.city}, {SITE_INFO.address.state}{" "}
        {SITE_INFO.address.postalCode}, {SITE_INFO.address.country}
      </CopyableRow>
      <CopyableRow icon={BuildingIcon} copyValue={SITE_INFO.legalName}>
        {SITE_INFO.legalName}
      </CopyableRow>
      <CopyableRow icon={LinkIcon} copyValue={website}>
        <a
          href={website}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm text-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {website}
        </a>
      </CopyableRow>
    </div>
  );
}
