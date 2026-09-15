import type { Metadata } from "next";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { ExecutiveBoard } from "./executive-board";
import { getExecutiveBoardPageData } from "./queries";

export const metadata: Metadata = { title: "Executive Board" };

export default async function ExecutiveBoardPage({
  params,
}: PageProps<"/organizer/dashboard/[munId]/executive-board">) {
  const { munId } = await params;
  const data = await getExecutiveBoardPageData(munId);

  return (
    <WorkspacePage
      title="Executive Board"
      description="Manage chairs, directors and moderators, with their bios, photos and committee assignments."
    >
      <ExecutiveBoard munId={munId} data={data} />
    </WorkspacePage>
  );
}
