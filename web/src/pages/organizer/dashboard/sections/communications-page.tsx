import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { History, MailX, Send } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import {
  communicationKeys,
  COMMUNICATION_LIMITS,
  listCommunications,
  previewAudience,
  sendCommunication,
  type CommunicationAudience,
  type MessageableStatus,
} from "@/api/organizer-communications";
import { listCommitteesForDelegates } from "@/api/organizer-dashboard";
import { listRegistrationProducts } from "@/api/registration-products";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/organizer/workspace-page";

const SELECT_CLASS = "h-11 w-full rounded-sm border border-input bg-background px-md text-body-md text-ink";

const STATUS_OPTIONS: Array<{ value: string; label: string; statuses?: MessageableStatus[] }> = [
  { value: "", label: "Everyone with a confirmed seat" },
  { value: "CONFIRMED", label: "Not checked in yet", statuses: ["CONFIRMED"] },
  { value: "ATTENDED", label: "Checked in", statuses: ["ATTENDED"] },
  { value: "NO_SHOW", label: "Marked no-show", statuses: ["NO_SHOW"] },
];

const sentAtFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Communications — plain-text messages from the MUN to its delegates
 * (lib/actions/organizer-communications.ts). Operational messages reach every
 * selected delegate regardless of their optional-email preference; the
 * composer says so. Limits (recipients per message, messages per hour) are
 * enforced server-side and surfaced here.
 */
export function OrganizerCommunicationsPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [statusOption, setStatusOption] = useState("");
  const [passId, setPassId] = useState("");
  const [committeeId, setCommitteeId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const audience: CommunicationAudience = useMemo(
    () => ({
      statuses: STATUS_OPTIONS.find((option) => option.value === statusOption)?.statuses,
      registrationProductId: passId || undefined,
      committeeId: committeeId || undefined,
    }),
    [statusOption, passId, committeeId],
  );

  const committeesQuery = useQuery({
    queryKey: queryKeys.committees(munId),
    queryFn: () => listCommitteesForDelegates(munId),
    enabled: Boolean(munId),
  });
  const passesQuery = useQuery({
    queryKey: queryKeys.registrationProducts(munId),
    queryFn: () => listRegistrationProducts(munId),
    enabled: Boolean(munId),
  });
  const previewQuery = useQuery({
    queryKey: communicationKeys.audience(munId, audience),
    queryFn: () => previewAudience(munId, audience),
    enabled: Boolean(munId),
    placeholderData: (previous) => previous,
  });
  const historyQuery = useQuery({
    queryKey: communicationKeys.history(munId),
    queryFn: () => listCommunications(munId),
    enabled: Boolean(munId),
  });

  const sendMutation = useMutation({
    mutationFn: () => sendCommunication(munId, { subject, body, audience }),
    onSuccess: async (result) => {
      if (result.failed === 0) {
        toast.success(`Message sent to ${plural(result.sent, "delegate")}`);
      } else {
        toast.warning(
          `Sent to ${result.sent} of ${plural(result.recipientCount, "delegate")} — ${result.failed} could not be delivered`,
        );
      }
      setSubject("");
      setBody("");
      setShowErrors(false);
      await queryClient.invalidateQueries({ queryKey: communicationKeys.all(munId) });
    },
    onError: async (error) => {
      toast.error(error instanceof Error ? error.message : "Unable to send the message");
      await queryClient.invalidateQueries({ queryKey: communicationKeys.all(munId) });
    },
  });

  const preview = previewQuery.data;
  const recipientCount = preview?.recipientCount ?? 0;
  const overCap = preview ? recipientCount > preview.maxRecipientsPerSend : false;
  const outOfSends = preview ? preview.sendsRemainingThisHour === 0 : false;
  const subjectMissing = subject.trim() === "";
  const bodyMissing = body.trim() === "";
  const subjectTooLong = subject.trim().length > COMMUNICATION_LIMITS.subjectMaxLength;
  const bodyTooLong = body.trim().length > COMMUNICATION_LIMITS.bodyMaxLength;
  const history = historyQuery.data ?? [];

  const submit = () => {
    if (subjectMissing || bodyMissing || subjectTooLong || bodyTooLong) {
      setShowErrors(true);
      return;
    }
    if (!preview || recipientCount === 0 || overCap || outOfSends) return;
    if (!window.confirm(`Send "${subject.trim()}" to ${plural(recipientCount, "delegate")}? This can't be undone.`)) {
      return;
    }
    sendMutation.mutate();
  };

  return (
    <>
      <Helmet title="Communications" />
      <WorkspacePage
        title="Communications"
        description="Email your delegates about schedules, venue changes and reminders. Messages are sent from MUN Hub on your conference's behalf."
      >
        <div className="grid gap-lg xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader>
              <CardTitle>New message</CardTitle>
              <CardDescription>
                Plain text only. Leave a blank line between paragraphs. Delegates receive this even if they've
                turned off optional emails, so keep it to conference business.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-md"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <div className="flex flex-col gap-xs">
                  <div className="flex items-baseline justify-between gap-sm">
                    <Label htmlFor="comms-subject">Subject</Label>
                    <span className="text-caption text-muted-foreground tabular-nums">
                      {subject.trim().length}/{COMMUNICATION_LIMITS.subjectMaxLength}
                    </span>
                  </div>
                  <Input
                    id="comms-subject"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value.replace(/[\r\n]/g, " "))}
                    placeholder="e.g. Day 1 venue change"
                    aria-invalid={showErrors && (subjectMissing || subjectTooLong) ? true : undefined}
                    aria-describedby={showErrors && (subjectMissing || subjectTooLong) ? "comms-subject-error" : undefined}
                  />
                  {showErrors && (subjectMissing || subjectTooLong) && (
                    <p id="comms-subject-error" className="text-body-md text-destructive">
                      {subjectMissing
                        ? "Add a subject."
                        : `Keep the subject to ${COMMUNICATION_LIMITS.subjectMaxLength} characters.`}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-xs">
                  <div className="flex items-baseline justify-between gap-sm">
                    <Label htmlFor="comms-body">Message</Label>
                    <span className="text-caption text-muted-foreground tabular-nums">
                      {body.trim().length}/{COMMUNICATION_LIMITS.bodyMaxLength}
                    </span>
                  </div>
                  <textarea
                    id="comms-body"
                    rows={10}
                    className="min-h-40 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 aria-invalid:border-destructive dark:bg-card"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={"Hi delegates,\n\nA quick update about day one..."}
                    aria-invalid={showErrors && (bodyMissing || bodyTooLong) ? true : undefined}
                    aria-describedby={showErrors && (bodyMissing || bodyTooLong) ? "comms-body-error" : undefined}
                  />
                  {showErrors && (bodyMissing || bodyTooLong) && (
                    <p id="comms-body-error" className="text-body-md text-destructive">
                      {bodyMissing
                        ? "Write a message."
                        : `Keep the message to ${COMMUNICATION_LIMITS.bodyMaxLength} characters.`}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <p className="text-body-md text-muted-foreground" aria-live="polite">
                    {preview
                      ? recipientCount === 0
                        ? "Nobody to send to yet."
                        : `Will be sent to ${plural(recipientCount, "delegate")}.`
                      : "Counting recipients..."}
                  </p>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={sendMutation.isPending || !preview || recipientCount === 0 || overCap || outOfSends}
                  >
                    <Send aria-hidden /> {sendMutation.isPending ? "Sending..." : "Send message"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-lg">
            <Card>
              <CardHeader>
                <CardTitle>Recipients</CardTitle>
                <CardDescription>Only delegates holding a confirmed seat can be messaged.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-md">
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="comms-status">Delegates</Label>
                  <select
                    id="comms-status"
                    className={SELECT_CLASS}
                    value={statusOption}
                    onChange={(event) => setStatusOption(event.target.value)}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="comms-pass">Pass</Label>
                  <select id="comms-pass" className={SELECT_CLASS} value={passId} onChange={(event) => setPassId(event.target.value)}>
                    <option value="">All passes</option>
                    {(passesQuery.data ?? []).map((pass) => (
                      <option key={pass.id} value={pass.id}>
                        {pass.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="comms-committee">Committee</Label>
                  <select
                    id="comms-committee"
                    className={SELECT_CLASS}
                    value={committeeId}
                    onChange={(event) => setCommitteeId(event.target.value)}
                  >
                    <option value="">All committees</option>
                    {(committeesQuery.data ?? []).map((committee) => (
                      <option key={committee.id} value={committee.id}>
                        {committee.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-sm border border-border bg-surface-soft/60 px-md py-sm" aria-live="polite">
                  {previewQuery.isPending ? (
                    <Skeleton className="h-10 w-full" />
                  ) : previewQuery.isError ? (
                    <p role="alert" className="text-body-md text-destructive">
                      {previewQuery.error.message}
                    </p>
                  ) : preview && recipientCount === 0 ? (
                    <div className="flex items-start gap-sm">
                      <MailX className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div>
                        <h2 className="text-label-md text-ink">No delegates match these filters</h2>
                        <p className="text-body-md text-muted-foreground">Confirmed delegates will appear here.</p>
                      </div>
                    </div>
                  ) : preview ? (
                    <div className="flex flex-col gap-xxs">
                      <p className="font-display text-title-md text-ink tabular-nums">
                        {plural(recipientCount, "delegate")}
                      </p>
                      {overCap && (
                        <p className="text-body-md text-destructive">
                          One message can reach at most {preview.maxRecipientsPerSend} delegates. Narrow it by pass or
                          committee and send in parts.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
                {preview && (
                  <p className={`text-body-md ${outOfSends ? "text-destructive" : "text-muted-foreground"}`}>
                    {outOfSends
                      ? "You've sent the maximum number of messages for this hour. Try again later."
                      : `${plural(preview.sendsRemainingThisHour, "message")} left this hour.`}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recently sent</CardTitle>
              </CardHeader>
              <CardContent>
                {historyQuery.isPending && <Skeleton className="h-16 w-full" />}
                {historyQuery.isError && (
                  <p role="alert" className="text-body-md text-destructive">
                    {historyQuery.error.message}
                  </p>
                )}
                {historyQuery.isSuccess && history.length === 0 && (
                  <p className="flex items-center gap-xs text-body-md text-muted-foreground">
                    <History className="size-4" aria-hidden /> No messages sent yet.
                  </p>
                )}
                {history.length > 0 && (
                  <ul className="flex flex-col divide-y divide-border">
                    {history.map((entry) => (
                      <li key={entry.id} className="flex flex-col gap-xxs py-sm first:pt-0 last:pb-0">
                        <span className="font-medium text-ink break-words">{entry.subject || "(no subject)"}</span>
                        <span className="text-caption text-muted-foreground">
                          {plural(entry.recipientCount, "recipient")} · {entry.sentBy} ·{" "}
                          {sentAtFormatter.format(new Date(entry.sentAt))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </WorkspacePage>
    </>
  );
}
