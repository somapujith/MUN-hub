import { useParams } from "react-router";
import { RequireOrganizer } from "@/guards/require-organizer";
import { MunDetailPage } from "@/pages/mun-detail-page";
import { NotFoundPage } from "@/pages/not-found-page";

/**
 * "Preview as a delegate": the public MUN page for the organizer's own MUN,
 * before it's live. Registration is turned off. The API only serves it to the
 * owner (and staff).
 */
export function OrganizerMunPreviewPage() {
  const { munId } = useParams<{ munId: string }>();
  if (!munId) return <NotFoundPage />;
  return (
    <RequireOrganizer>
      <MunDetailPage previewMunId={munId} />
    </RequireOrganizer>
  );
}
