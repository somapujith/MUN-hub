import { Helmet } from "react-helmet-async";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { getMunNavSection } from "@/lib/organizer/nav-config";

const SECTION_DESCRIPTIONS: Record<string, string> = {
  setup: "Your conference's core record — how it's named, when it runs, and where delegates are going.",
  committees: "Committees and the portfolios delegates will represent.",
  "executive-board": "Secretariat and chair assignments for your conference.",
  products: "Registration passes, pricing, capacity, and deadlines.",
  form: "Custom fields delegates fill in during registration.",
  accommodation: "Paid add-ons and lodging options sold with registration.",
  registrations: "Delegate roster, payment status, and check-in readiness.",
  finance: "Payments collected, platform fees, and settlement settings.",
  communications: "Email templates and announcements to delegates.",
  documents: "Background guides, rules of procedure, and media assets.",
  "conference-day": "Schedule, venue logistics, and on-site operations.",
  results: "Awards, delegate rankings, and results publication.",
  certificates: "Certificate templates and issuance after the conference.",
  analytics: "Registration trends and conversion metrics.",
  team: "Co-organizers and role-based permissions.",
  settings: "Danger zone, slug, and conference lifecycle controls.",
};

interface MunSectionShellProps {
  segment: string;
}

export function MunSectionShell({ segment }: MunSectionShellProps) {
  const section = getMunNavSection(segment);
  const title = section?.title ?? section?.label ?? segment;
  const description = SECTION_DESCRIPTIONS[segment] ?? "Organizer workspace section (mock shell).";

  return (
    <>
      <Helmet title={title} />
      <WorkspacePage title={title} description={description}>
        <div className="rounded-md border border-dashed border-border bg-surface-soft/60 p-lg dark:bg-card">
          <p className="text-body-md text-muted-foreground">
            Presentational shell — API wiring deferred to Phase 5.2+. Mock data only.
          </p>
        </div>
      </WorkspacePage>
    </>
  );
}
