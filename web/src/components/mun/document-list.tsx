import { DownloadIcon, FileTextIcon } from "lucide-react";
import { formatFileSize, safeLinkUrl } from "@/components/mun/mun-format";
import { DOCUMENT_KIND_LABELS } from "@/lib/mun-public-labels";
import type { PublicMunDocument } from "@/types/public-mun";

/** Downloadable conference documents (rules, guides, brochures). */
export function DocumentList({ documents }: { documents: PublicMunDocument[] }) {
  return (
    <ul className="list-none divide-y divide-border overflow-hidden rounded-md border border-border bg-card p-0">
      {documents.map((document) => {
        const href = safeLinkUrl(document.url);
        const size = formatFileSize(document.sizeBytes);
        const meta = [DOCUMENT_KIND_LABELS[document.kind] ?? "Document", document.contentType === "application/pdf" ? "PDF" : null, size]
          .filter(Boolean)
          .join(" · ");

        return (
          <li key={document.id} className="flex items-center gap-md px-lg py-md">
            <FileTextIcon aria-hidden strokeWidth={1.75} className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-label-md break-words text-ink">{document.title}</p>
              <p className="mt-xxs text-body-md text-muted-foreground">{meta}</p>
            </div>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="inline-flex shrink-0 items-center gap-xxs rounded-sm px-xs py-xxs text-body-md text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                <DownloadIcon aria-hidden className="size-4" strokeWidth={1.75} />
                Download
                <span className="sr-only"> {document.title}</span>
              </a>
            ) : (
              <span className="shrink-0 text-body-md text-muted-foreground">Unavailable</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
