import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { deleteMunDocument, listMunDocuments, uploadMunDocument } from "@/api/mun-documents";
import { queryKeys } from "@/api/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type { MunDocumentKind } from "@/types/mun-documents";

// Mirrors lib/actions/mun-documents.ts's validateUpload — client-side check
// only, the server is the source of truth and re-validates independently.
const ALLOWED_CONTENT_TYPE = "application/pdf";
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const KIND_OPTIONS: Array<{ value: MunDocumentKind; label: string }> = [
  { value: "RULES", label: "Rules of procedure" },
  { value: "CODE_OF_CONDUCT", label: "Code of conduct" },
  { value: "REFUND_POLICY", label: "Refund policy" },
  { value: "BROCHURE", label: "Brochure" },
  { value: "HANDBOOK", label: "Handbook" },
  { value: "DELEGATE_GUIDE", label: "Delegate guide" },
  { value: "POSITION_PAPER", label: "Position paper" },
  { value: "OTHER", label: "Other" },
];

function kindLabel(kind: MunDocumentKind): string {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Reads a File as raw base64 (strips the "data:...;base64," prefix the server doesn't want). */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

export function OrganizerDocumentsPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<MunDocumentKind>("RULES");
  const [title, setTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const documentsQuery = useQuery({
    queryKey: queryKeys.munDocuments(munId),
    queryFn: () => listMunDocuments(munId),
    enabled: Boolean(munId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.munDocuments(munId) });

  const resetForm = () => {
    setTitle("");
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("Choose a PDF to upload");
      const fileBase64 = await readFileAsBase64(selectedFile);
      return uploadMunDocument(munId, {
        kind,
        title: title.trim(),
        contentType: "application/pdf",
        fileBase64,
      });
    },
    onSuccess: async () => {
      await refresh();
      resetForm();
      toast.success("Document uploaded");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to upload document"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMunDocument,
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to delete document"),
  });

  const documents = documentsQuery.data ?? [];

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file && file.type !== ALLOWED_CONTENT_TYPE) {
      toast.error("Only PDF files are allowed");
      event.target.value = "";
      setSelectedFile(null);
      return;
    }
    if (file && file.size > MAX_SIZE_BYTES) {
      toast.error("File too large — maximum allowed size is 20MB");
      event.target.value = "";
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!selectedFile) {
      toast.error("Choose a PDF to upload");
      return;
    }
    uploadMutation.mutate();
  };

  return (
    <>
      <Helmet title="Documents" />
      <WorkspacePage
        title="Documents"
        description="Background guides, rules of procedure, and other reference materials for delegates."
      >
        <div className="grid gap-lg xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Uploaded documents" className="flex flex-col gap-md">
            {documentsQuery.isLoading && (
              <p className="text-body-md text-muted-foreground">Loading documents...</p>
            )}
            {documentsQuery.isError && (
              <p className="text-body-md text-destructive">{documentsQuery.error.message}</p>
            )}
            {!documentsQuery.isLoading && documents.length === 0 && (
              <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
                <FileText className="mx-auto size-8 text-muted-foreground" aria-hidden />
                <h2 className="mt-md font-display text-title-sm text-ink">No documents yet</h2>
                <p className="mt-xs text-body-md text-muted-foreground">
                  Upload a PDF so delegates can find rules, handbooks, and policies.
                </p>
              </div>
            )}
            {documents.map((document) => (
              <Card key={document.id} size="sm">
                <CardContent className="flex flex-wrap items-center gap-md">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-surface-soft text-muted-foreground">
                    <FileText aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
                      <h2 className="font-display text-title-sm text-ink">{document.title}</h2>
                      <Badge variant="secondary">{kindLabel(document.kind)}</Badge>
                    </div>
                    <p className="mt-xxs text-body-md text-muted-foreground">
                      {formatSize(document.sizeBytes)} · Uploaded {new Date(document.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-xxs">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Download ${document.title}`}
                      render={<a href={document.url} target="_blank" rel="noreferrer" />}
                    >
                      <Download aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete ${document.title}`}
                      onClick={() => {
                        if (window.confirm(`Delete "${document.title}"?`)) deleteMutation.mutate(document.id);
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Upload document</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-md" onSubmit={handleSubmit}>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="doc-title">Title</Label>
                  <Input
                    id="doc-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="doc-kind">Type</Label>
                  <select
                    id="doc-kind"
                    className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                    value={kind}
                    onChange={(event) => setKind(event.target.value as MunDocumentKind)}
                  >
                    {KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="doc-file">PDF file (max 20MB)</Label>
                  <Input
                    id="doc-file"
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileChange}
                    required
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={uploadMutation.isPending}>
                    <Upload aria-hidden /> {uploadMutation.isPending ? "Uploading..." : "Upload"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </WorkspacePage>
    </>
  );
}
