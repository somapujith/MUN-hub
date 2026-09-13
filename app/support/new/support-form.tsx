"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import { toast } from "sonner";
import { CheckCircle2Icon, Loader2Icon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTicket } from "@/lib/actions/support";
import type { SupportCategory } from "@/lib/db/schema-enums";

const CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: "REGISTRATION", label: "Registration" },
  { value: "PAYMENT", label: "Payment" },
  { value: "REFUND", label: "Refund" },
  { value: "MUN_INFO", label: "MUN info" },
  { value: "ACCOUNT", label: "Account" },
  { value: "CERTIFICATE", label: "Certificate" },
  { value: "ORGANIZER", label: "Organizer" },
  { value: "TECHNICAL", label: "Technical issue" },
  { value: "SAFETY_POLICY", label: "Safety / policy" },
];

const selectClassName = cn(
  "h-11 w-full min-w-0 rounded-sm border border-input bg-background px-md py-sm text-base text-ink transition-colors outline-none md:text-body-md",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card"
);

const textareaClassName = cn(
  "w-full min-w-0 resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink transition-colors outline-none",
  "placeholder:text-muted-foreground",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
  "disabled:pointer-events-none disabled:bg-surface-soft disabled:text-muted-foreground",
  "dark:bg-card"
);

/**
 * "Contact support" form. Every field is `useState`-controlled (not an
 * uncontrolled form) so the submit button's disabled-on-empty gate stays
 * accurate — same reasoning that fixed the uncontrolled-textarea bug in
 * `app/admin/organizers/suspend-dialog.tsx` (Task 3 review) applies to any
 * disabled-button gate, not just admin dialogs.
 *
 * Calls `createTicket` (a `'use server'` action) directly rather than going
 * through a route-local `actions.ts` wrapper: unlike the admin queue, there
 * is no list to `revalidatePath` after submit — the form just swaps to a
 * confirmation state — and `createTicket` only throws `Forbidden`, which
 * can't happen here since the page already redirects unauthenticated users
 * before this component ever renders.
 */
export function SupportForm() {
  const [category, setCategory] = React.useState<SupportCategory>("TECHNICAL");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const router = useRouter();

  const canSubmit = subject.trim().length > 0 && description.trim().length > 0;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;

    startTransition(async () => {
      try {
        await createTicket({
          category,
          subject: subject.trim(),
          description: description.trim(),
        });
        setSubmitted(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong. Try again.";
        toast.error("Could not submit ticket", { description: message });
      }
    });
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-section text-center">
        <CheckCircle2Icon className="size-8 text-success" strokeWidth={1.25} aria-hidden />
        <p className="font-display text-title-md text-ink">Ticket submitted.</p>
        <p className="max-w-sm text-body-md text-muted-foreground">
          Our team will follow up by email. You can close this page.
        </p>
        <Button variant="outline" size="sm" onClick={() => router.push("/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-md">
      <div className="flex flex-col gap-xs">
        <Label htmlFor="support-category">Category</Label>
        <select
          id="support-category"
          className={selectClassName}
          value={category}
          onChange={(e) => setCategory(e.target.value as SupportCategory)}
          disabled={pending}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-xs">
        <Label htmlFor="support-subject">Subject</Label>
        <Input
          id="support-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Short summary of the issue"
          disabled={pending}
          required
        />
      </div>

      <div className="flex flex-col gap-xs">
        <Label htmlFor="support-description">Describe the issue</Label>
        <textarea
          id="support-description"
          rows={5}
          className={textareaClassName}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Include as much detail as you can — what happened, what you expected, and any relevant dates or reference numbers."
          disabled={pending}
          required
        />
      </div>

      <Button type="submit" disabled={pending || !canSubmit} className="self-start">
        {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
        {pending ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}
