import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { BadgeCheck, ExternalLink } from "lucide-react";
import { useParams } from "react-router";
import { listCertificates } from "@/api/certificates";
import { queryKeys } from "@/api/query-keys";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type { Certificate } from "@/types/certificate";

function statusVariant(status: string): "success" | "outline" {
  return status === "verified" ? "success" : "outline";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Read-only list — certificates are schema-scaffolded per the PRD ("no
 * logic/UI in MVP"), so there is deliberately no issuance, editing, or
 * deletion here, only a view of whatever rows (if any) already exist.
 */
export function OrganizerCertificatesPage() {
  const { munId = "" } = useParams();
  const certificatesQuery = useQuery({
    queryKey: queryKeys.certificates(munId),
    queryFn: () => listCertificates(munId),
    enabled: Boolean(munId),
  });
  const certificates: Certificate[] = certificatesQuery.data ?? [];

  return (
    <>
      <Helmet title="Certificates" />
      <WorkspacePage
        title="Certificates"
        description="Certificates issued to delegates for this conference. Issuance is not yet built — this is a read-only view of existing records."
      >
        <section aria-label="Issued certificates" className="flex flex-col gap-md">
          {certificatesQuery.isLoading && (
            <p className="text-body-md text-muted-foreground">Loading certificates...</p>
          )}
          {certificatesQuery.isError && (
            <p className="text-body-md text-destructive">
              {certificatesQuery.error instanceof Error
                ? certificatesQuery.error.message
                : "Unable to load certificates."}
            </p>
          )}
          {!certificatesQuery.isLoading && certificates.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
              <BadgeCheck className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <h2 className="mt-md font-display text-title-sm text-ink">No certificates yet</h2>
              <p className="mt-xs text-body-md text-muted-foreground">
                Nothing has been issued for this conference. Certificate generation isn't part of
                the current MVP.
              </p>
            </div>
          )}
          {certificates.map((certificate) => (
            <Card key={certificate.id} size="sm">
              <CardContent className="flex flex-wrap items-center justify-between gap-md">
                <div className="min-w-0">
                  <p className="font-display text-title-sm text-ink">{certificate.user.name}</p>
                  <p className="mt-xxs text-body-md text-muted-foreground">
                    {certificate.user.email}
                  </p>
                  <p className="mt-xxs text-caption text-muted-foreground">
                    Issued {formatDate(certificate.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-sm">
                  <Badge variant={statusVariant(certificate.verificationStatus)}>
                    {certificate.verificationStatus}
                  </Badge>
                  {certificate.certificateUrl && (
                    <a
                      href={certificate.certificateUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-xxs text-body-md text-link hover:underline"
                    >
                      View <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      </WorkspacePage>
    </>
  );
}
