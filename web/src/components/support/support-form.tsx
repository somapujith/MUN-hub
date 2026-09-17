import * as React from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircleIcon, Loader2Icon, SendIcon } from "lucide-react";
import { createSupportTicket } from "@/api/support";
import { getOrganizerWorkspaceOverview } from "@/api/organizer-dashboard";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { REQUESTER_CATEGORY_OPTIONS } from "@/components/support/support-labels";
import { ZoneLink } from "@/components/support/zone-link";
import { inboxUrlForRole } from "@/components/support/support-labels";
import { isCrossOrigin } from "@/lib/host-routing";
import { invalidateSupportSummaries } from "@/components/support/use-support";
import { useSession } from "@/hooks/use-session";
import { SUPPORT_LIMITS, type RequesterCategory } from "@/types/support";

const fieldClassName =
  "w-full rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:bg-surface-soft dark:bg-card";

function Counter({ id, length, max }: { id: string; length: number; max: number }) {
  return (
    <span id={id} className={`text-[12px] tabular-nums ${length > max ? "text-destructive" : "text-muted-foreground"}`}>
      {length}/{max}
    </span>
  );
}

/**
 * The full support form: category, subject, details and — for organizers —
 * which of their conferences it is about. Filing opens the new conversation
 * in the requester's inbox, where the reply will arrive.
 */
export function SupportForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isOrganizer = session?.role === "ORGANIZER";

  const [category, setCategory] = React.useState<RequesterCategory>(isOrganizer ? "ORGANIZER" : "GENERAL");
  const [munId, setMunId] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");

  const workspaceQuery = useQuery({
    queryKey: queryKeys.organizerWorkspace(),
    queryFn: getOrganizerWorkspaceOverview,
    enabled: isOrganizer,
  });
  const muns = workspaceQuery.data?.muns ?? [];

  const submitMutation = useMutation({
    mutationFn: () =>
      createSupportTicket({
        category,
        subject: subject.trim(),
        description: description.trim(),
        relatedMunId: munId || undefined,
      }),
    onSuccess: (ticket) => {
      invalidateSupportSummaries(queryClient);
      toast.success("Ticket created. We'll reply in your support inbox.");
      const url = inboxUrlForRole(session?.role ?? "STUDENT", ticket.id);
      if (isCrossOrigin(url)) window.location.assign(url);
      else navigate(url, { replace: true });
    },
  });

  const pending = submitMutation.isPending;
  const subjectLength = subject.trim().length;
  const descriptionLength = description.trim().length;
  const canSubmit =
    subjectLength > 0 &&
    subjectLength <= SUPPORT_LIMITS.subject &&
    descriptionLength > 0 &&
    descriptionLength <= SUPPORT_LIMITS.body;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || pending) return;
    submitMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-md" noValidate>
      <div className="flex flex-col gap-xs">
        <Label htmlFor="support-category">Category</Label>
        <select
          id="support-category"
          className={`h-11 ${fieldClassName}`}
          value={category}
          onChange={(event) => setCategory(event.target.value as RequesterCategory)}
          disabled={pending}
        >
          {REQUESTER_CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {isOrganizer && muns.length > 0 && (
        <div className="flex flex-col gap-xs">
          <Label htmlFor="support-mun">Conference (optional)</Label>
          <select
            id="support-mun"
            className={`h-11 ${fieldClassName}`}
            value={munId}
            onChange={(event) => setMunId(event.target.value)}
            disabled={pending}
          >
            <option value="">Not about a specific conference</option>
            {muns.map((mun) => (
              <option key={mun.id} value={mun.id}>
                {mun.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-xs">
        <div className="flex items-center justify-between gap-sm">
          <Label htmlFor="support-subject">Subject</Label>
          <Counter id="support-subject-count" length={subjectLength} max={SUPPORT_LIMITS.subject} />
        </div>
        <Input
          id="support-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={SUPPORT_LIMITS.subject}
          aria-describedby="support-subject-count"
          required
          disabled={pending}
        />
      </div>

      <div className="flex flex-col gap-xs">
        <div className="flex items-center justify-between gap-sm">
          <Label htmlFor="support-description">Describe the issue</Label>
          <Counter id="support-description-count" length={descriptionLength} max={SUPPORT_LIMITS.body} />
        </div>
        <textarea
          id="support-description"
          rows={6}
          className={`resize-y ${fieldClassName}`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={SUPPORT_LIMITS.body}
          aria-describedby="support-description-hint support-description-count"
          required
          disabled={pending}
        />
        <p id="support-description-hint" className="text-[12px] text-muted-foreground">
          Include the conference name and any order or registration reference. Never share card numbers or passwords.
        </p>
      </div>

      {submitMutation.isError && (
        <p role="alert" className="flex items-start gap-xs rounded-sm border border-destructive/30 bg-destructive/10 px-sm py-xs text-body-md text-destructive-text">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {submitMutation.error.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-sm">
        <Button type="submit" disabled={pending || !canSubmit}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
          {pending ? "Submitting…" : "Submit"}
        </Button>
        <ZoneLink
          url={inboxUrlForRole(session?.role ?? "STUDENT")}
          className="text-body-md text-link underline-offset-4 hover:underline"
        >
          Back to support inbox
        </ZoneLink>
      </div>
    </form>
  );
}
