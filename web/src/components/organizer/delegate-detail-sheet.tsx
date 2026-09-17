import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserCheck, UserX } from "lucide-react";
import { delegateDetailKey, getDelegateDetail } from "@/api/organizer-dashboard";
import { RegistrationStatusChip } from "@/components/dashboard/registration-status-chip";
import { getPaymentStatusMeta, getToneClassName } from "@/components/dashboard/registration-status";
import { formatPrice } from "@/components/shared/currency";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { AttendanceStatus, DelegateAnswer, DelegateDetail } from "@/types/organizer-dashboard";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const CHECK_IN_LABELS: Record<DelegateDetail["checkIn"]["state"], string> = {
  NOT_CHECKED_IN: "Not checked in yet",
  CHECKED_IN: "Checked in",
  NO_SHOW: "Marked as no-show",
  NOT_APPLICABLE: "No seat held — check-in doesn't apply",
};

interface DelegateDetailSheetProps {
  munId: string;
  /** The open row; null closes the sheet. */
  registrationId: string | null;
  onClose: () => void;
  attendanceOpen: boolean;
  onMarkAttendance: (registrationId: string, status: AttendanceStatus) => void;
  attendancePending: boolean;
}

/**
 * Owner-only drawer with one delegate's full registration record: contact,
 * pass and seat, payment, check-in, profile essentials and form answers.
 * Fetched on open (never part of the roster list payload).
 */
export function DelegateDetailSheet({
  munId,
  registrationId,
  onClose,
  attendanceOpen,
  onMarkAttendance,
  attendancePending,
}: DelegateDetailSheetProps) {
  const detailQuery = useQuery({
    queryKey: delegateDetailKey(munId, registrationId ?? ""),
    queryFn: () => getDelegateDetail(munId, registrationId ?? ""),
    enabled: Boolean(munId && registrationId),
  });
  const detail = detailQuery.data;

  return (
    <Sheet open={registrationId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[34rem]">
        <SheetHeader>
          <SheetTitle>{detail?.delegate.name ?? "Delegate"}</SheetTitle>
          <SheetDescription>
            {detail ? (
              <span className="flex flex-wrap items-center gap-xs">
                <RegistrationStatusChip status={detail.registration.status} />
                <span className="font-mono text-legal text-muted-foreground">{detail.registration.id}</span>
              </span>
            ) : (
              "Registration details"
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-lg px-lg pb-lg">
          {detailQuery.isPending && (
            <div className="flex flex-col gap-sm" aria-busy="true" aria-label="Loading delegate">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {detailQuery.isError && (
            <p role="alert" className="text-body-md text-destructive">
              {detailQuery.error.message}
            </p>
          )}
          {detail && (
            <>
              <DetailSection title="Contact">
                <DetailRow label="Email" value={detail.delegate.email} />
                <DetailRow label="Phone" value={detail.delegate.phone} />
                <DetailRow label="Institution" value={detail.delegate.institution} />
              </DetailSection>

              <DetailSection title="Registration">
                <DetailRow label="Pass" value={`${detail.pass.name} · ${formatPrice(detail.pass.price)}`} />
                <DetailRow label="Committee" value={detail.committee?.name ?? "Unassigned"} />
                <DetailRow label="Portfolio" value={detail.portfolio?.name ?? "Unassigned"} />
                <DetailRow label="Registered" value={dateFormatter.format(new Date(detail.registration.createdAt))} />
              </DetailSection>

              <DetailSection title="Payment">
                {detail.payment ? (
                  <>
                    <div className="flex items-center justify-between gap-md">
                      <dt className="text-muted-foreground">Status</dt>
                      <dd>
                        <Badge
                          variant="outline"
                          className={getToneClassName(getPaymentStatusMeta(detail.payment.status).tone)}
                        >
                          {getPaymentStatusMeta(detail.payment.status).label}
                        </Badge>
                      </dd>
                    </div>
                    <DetailRow label="Amount" value={formatPrice(detail.payment.amount)} />
                    <DetailRow label="Updated" value={dateTimeFormatter.format(new Date(detail.payment.updatedAt))} />
                  </>
                ) : (
                  <p className="text-body-md text-muted-foreground">No payment recorded.</p>
                )}
              </DetailSection>

              <DetailSection title="Check-in">
                <DetailRow
                  label="Status"
                  value={
                    detail.checkIn.recordedAt
                      ? `${CHECK_IN_LABELS[detail.checkIn.state]} · ${dateTimeFormatter.format(new Date(detail.checkIn.recordedAt))}`
                      : CHECK_IN_LABELS[detail.checkIn.state]
                  }
                />
                {attendanceOpen && detail.checkIn.state !== "NOT_APPLICABLE" && (
                  <div className="flex flex-wrap gap-xs pt-xs">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={attendancePending || detail.checkIn.state === "CHECKED_IN"}
                      onClick={() => onMarkAttendance(detail.registration.id, "ATTENDED")}
                    >
                      <UserCheck aria-hidden /> Mark attended
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={attendancePending || detail.checkIn.state === "NO_SHOW"}
                      onClick={() => onMarkAttendance(detail.registration.id, "NO_SHOW")}
                    >
                      <UserX aria-hidden /> Mark no-show
                    </Button>
                  </div>
                )}
              </DetailSection>

              <DetailSection title="Participant profile">
                {detail.delegate.profile ? (
                  <>
                    <DetailRow
                      label="Date of birth"
                      value={dateFormatter.format(new Date(detail.delegate.profile.dateOfBirth))}
                    />
                    <DetailRow label="Grade / year" value={detail.delegate.profile.gradeOrYear} />
                    <DetailRow label="Course" value={detail.delegate.profile.courseOrProgram} />
                    <DetailRow
                      label="Location"
                      value={[detail.delegate.profile.city, detail.delegate.profile.state, detail.delegate.profile.country]
                        .filter(Boolean)
                        .join(", ")}
                    />
                    <DetailRow
                      label="Needs transport"
                      value={detail.delegate.profile.requiresTransportation ? "Yes" : "No"}
                    />
                    <DetailRow
                      label="Emergency contact"
                      value={`${detail.delegate.profile.emergencyContactName} (${detail.delegate.profile.emergencyContactRelation}) · ${detail.delegate.profile.emergencyContactPhone}`}
                    />
                  </>
                ) : (
                  <p className="text-body-md text-muted-foreground">
                    This delegate registered before the participant profile existed.
                  </p>
                )}
              </DetailSection>

              <DetailSection title="Registration answers">
                <AnswerList answers={detail.answers} empty="No answers recorded." />
              </DetailSection>

              {detail.accommodation && (
                <DetailSection title={`Accommodation · ${detail.accommodation.name}`}>
                  <AnswerList answers={detail.accommodation.answers} empty="No accommodation details given." />
                </DetailSection>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-xs">
      <h3 className="text-label-md text-ink">{title}</h3>
      <dl className="flex flex-col gap-xs rounded-sm border border-border bg-surface-soft/60 px-md py-sm text-body-md">
        {children}
      </dl>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-md">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words text-ink">{value || "—"}</dd>
    </div>
  );
}

function AnswerList({ answers, empty }: { answers: DelegateAnswer[]; empty: string }) {
  if (answers.length === 0) return <p className="text-body-md text-muted-foreground">{empty}</p>;
  return (
    <>
      {answers.map((answer) => (
        <div key={answer.key} className="flex flex-col gap-xxs border-b border-border pb-xs last:border-0 last:pb-0">
          <dt className="text-muted-foreground">{answer.label}</dt>
          <dd className="break-words whitespace-pre-line text-ink">{answer.value}</dd>
        </div>
      ))}
    </>
  );
}
