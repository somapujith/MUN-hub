import { MessageSquareWarningIcon } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MODULE_SECTION, contentReviewNotes } from "@/lib/organizer/go-live";
import { munSectionHref } from "@/lib/organizer/nav-config";
import type { MunModule } from "@/types/enums";
import type { MunReviewFeedback } from "@/types/go-live";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const APPLICATION_STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Application submitted",
  UNDER_REVIEW: "Application under review",
  APPROVED: "Application approved",
  REJECTED: "Application not approved",
  CHANGES_REQUESTED: "Application needs changes",
};

const SEVERITY_VARIANT = {
  BLOCKER: "destructive",
  HIGH: "destructive",
  MEDIUM: "warning",
  LOW: "secondary",
} as const;

/**
 * Notes from MUN Hub reviewers: the Gate-1 application decision, Gate-2
 * content-review notes, and open issues on individual sections.
 */
export function ReviewFeedbackCard({ munId, feedback }: { munId: string; feedback: MunReviewFeedback }) {
  const openIssues = feedback.issues.filter((issue) => !issue.resolved);
  const applicationNotes = feedback.application?.reviewNotes?.trim();
  const reviewerNotes = contentReviewNotes(feedback);

  return (
    <Card aria-labelledby="review-feedback-title">
      <CardHeader>
        <CardTitle>
          <h2 id="review-feedback-title" className="flex items-center gap-xs text-title-sm">
            <MessageSquareWarningIcon className="size-4" aria-hidden />
            Feedback from MUN Hub
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-md">
        {openIssues.length > 0 && (
          <section className="flex flex-col gap-xs">
            <h3 className="text-body-md font-medium text-ink">What to fix</h3>
            <ul className="flex flex-col gap-xs">
              {openIssues.map((issue) => {
                const segment = MODULE_SECTION[issue.moduleName as MunModule];
                return (
                  <li
                    key={issue.id}
                    className="flex flex-col gap-xxs rounded-sm border border-border px-sm py-xs text-body-md"
                  >
                    <div className="flex flex-wrap items-center gap-xs">
                      <span className="font-medium text-ink">{issue.moduleLabel}</span>
                      <Badge variant={SEVERITY_VARIANT[issue.severity]}>{issue.severity.toLowerCase()}</Badge>
                    </div>
                    <p className="text-body">{issue.reason}</p>
                    {segment && (
                      <Link
                        to={munSectionHref(munId, segment)}
                        className="w-fit text-caption font-medium text-link underline-offset-2 hover:underline"
                      >
                        Fix {issue.moduleLabel}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-caption text-muted-foreground">
              When a section is fixed, send it for review again from the checklist below.
            </p>
          </section>
        )}

        {reviewerNotes.length > 0 && (
          <section className="flex flex-col gap-xs">
            <h3 className="text-body-md font-medium text-ink">Reviewer notes</h3>
            <ul className="flex flex-col gap-xs">
              {reviewerNotes.map((note) => (
                <li key={note.id} className="border-l-2 border-border pl-sm text-body-md">
                  <p className="whitespace-pre-line text-body">{note.notes}</p>
                  <p className="text-caption text-muted-foreground">
                    {dateFormatter.format(new Date(note.createdAt))}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {applicationNotes && feedback.application && (
          <section className="flex flex-col gap-xxs">
            <h3 className="text-body-md font-medium text-ink">
              {APPLICATION_STATUS_LABEL[feedback.application.status] ?? "Your application"}
            </h3>
            <p className="whitespace-pre-line text-body-md text-body">{applicationNotes}</p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
