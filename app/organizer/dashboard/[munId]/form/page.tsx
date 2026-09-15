import type { Metadata } from "next";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { listFormFields } from "@/lib/actions/registration-form";
import { FormBuilder } from "./form-builder";

/**
 * PLACEHOLDER — Registration Form (PRD § 5).
 *
 * Shell only. Replace `<ModulePlaceholder>` with the real module; keep the
 * `<WorkspacePage>` wrapper, which is this section's permanent chrome. The
 * mun id is on `params.munId` — pass it straight to the frozen
 * `lib/actions/*` contract, which re-checks ownership server-side. Do not add
 * an auth check here: `../../layout.tsx` already gated this route.
 */

export const metadata: Metadata = { title: "Registration Form" };

export default async function FormPage({ params }: PageProps<"/organizer/dashboard/[munId]/form">) {
  const { munId } = await params;
  const fields = await listFormFields(munId);
  return (
    <WorkspacePage title="Registration form">
      <FormBuilder munId={munId} fields={fields} />
    </WorkspacePage>
  );
}
