import * as React from "react";
import { useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { cn } from "cn";
import { toast } from "sonner";
import { CheckCircle2Icon, Loader2Icon, SendIcon } from "lucide-react";
import { createSupportTicket } from "@/api/support";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SupportCategory } from "@/types";

// No "Refund" choice: all payments are final (/legal/refunds). Payment
// errors go under "Payment". The REFUND enum value stays for old tickets.
const CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: "REGISTRATION", label: "Registration" },
  { value: "PAYMENT", label: "Payment" },
  { value: "MUN_INFO", label: "MUN info" },
  { value: "ACCOUNT", label: "Account" },
  { value: "CERTIFICATE", label: "Certificate" },
  { value: "ORGANIZER", label: "Organizer" },
  { value: "TECHNICAL", label: "Technical issue" },
  { value: "SAFETY_POLICY", label: "Safety / policy" },
];

const selectClassName = cn(
  "h-11 w-full rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
);

const textareaClassName = cn(
  "w-full resize-y rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none",
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
);

export function SupportForm() {
  const [category, setCategory] = React.useState<SupportCategory>("TECHNICAL");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const navigate = useNavigate();

  const submitMutation = useMutation({
    mutationFn: () => createSupportTicket({ category, subject: subject.trim(), description: description.trim() }),
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Ticket submitted");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to submit ticket"),
  });

  const pending = submitMutation.isPending;
  const canSubmit = subject.trim().length > 0 && description.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || pending) return;
    submitMutation.mutate();
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-sm rounded-md border border-dashed border-border bg-card px-lg py-section text-center">
        <CheckCircle2Icon className="size-8 text-success" strokeWidth={1.25} aria-hidden />
        <p className="font-display text-title-md text-ink">Ticket submitted.</p>
        <p className="max-w-sm text-body-md text-muted-foreground">
          Our team will follow up by email. You can close this page.
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
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
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-xs">
        <Label htmlFor="support-subject">Subject</Label>
        <Input id="support-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required disabled={pending} />
      </div>
      <div className="flex flex-col gap-xs">
        <Label htmlFor="support-description">Describe the issue</Label>
        <textarea
          id="support-description"
          rows={5}
          className={textareaClassName}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          disabled={pending}
        />
      </div>
      <Button type="submit" disabled={pending || !canSubmit} className="self-start">
        {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
        {pending ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}
