import { useId, useRef, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { deleteMunMedia, listMunMedia, uploadMunMedia } from "@/api/mun-branding";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { checkCoverDimensions, readImageDimensions } from "@/lib/image-dimensions";
import { readFileAsBase64 } from "@/lib/read-file-as-base64";
import type { MunImageContentType, MunMediaItem } from "@/types/mun-branding";
import { cn } from "cn";

// Mirrors lib/storage/validate.ts's UPLOAD_RULES. Client-side hint only; the
// API checks type, size and the file's actual contents.
const IMAGE_TYPES: readonly MunImageContentType[] = ["image/png", "image/jpeg", "image/webp"];
const MB = 1024 * 1024;

const SLOTS = [
  {
    kind: "LOGO",
    title: "Logo",
    hint: "Square works best. PNG, JPEG or WebP, max 2MB.",
    inputLabel: "Logo image (max 2MB)",
    maxBytes: 2 * MB,
    maxLabel: "2MB",
    previewClass: "aspect-square w-28",
    checkDimensions: false,
  },
  {
    kind: "COVER",
    title: "Cover image",
    hint: "Shown at the top of your MUN page. Must be exactly 2000×480px (or a larger multiple of that 25:6 ratio, e.g. 4000×960px). PNG, JPEG or WebP, max 5MB.",
    inputLabel: "Cover image (max 5MB, 2000×480px or larger at the same 25:6 ratio)",
    maxBytes: 5 * MB,
    maxLabel: "5MB",
    previewClass: "aspect-[25/6] w-full max-w-2xl",
    checkDimensions: true,
  },
] as const;

type Slot = (typeof SLOTS)[number];

/** Logo and cover upload for the BRANDING module. Both are required to go live. */
export function BrandingUploads({ munId }: { munId: string }) {
  const mediaQuery = useQuery({
    queryKey: queryKeys.munMedia(munId),
    queryFn: () => listMunMedia(munId),
    enabled: Boolean(munId),
  });

  return (
    <Card aria-labelledby="branding-title">
      <CardHeader>
        <CardTitle>
          <h2 id="branding-title" className="text-title-sm">Branding</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-md">
        <p className="text-body-md text-muted-foreground">
          Your logo and cover image appear on your MUN&apos;s page and in search results. Both are needed before you
          submit for review, and you can change them at any time.
        </p>
        {mediaQuery.isError && <p className="text-body-md text-destructive">{mediaQuery.error.message}</p>}
        <div className="grid gap-md md:grid-cols-[auto_minmax(0,1fr)]">
          {SLOTS.map((slot) => (
            <BrandingSlot
              key={slot.kind}
              munId={munId}
              slot={slot}
              loading={mediaQuery.isLoading}
              current={mediaQuery.data?.find((item) => item.kind === slot.kind)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BrandingSlot({
  munId,
  slot,
  loading,
  current,
}: {
  munId: string;
  slot: Slot;
  loading: boolean;
  current: MunMediaItem | undefined;
}) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.munMedia(munId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.munProgress(munId) }),
    ]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) =>
      uploadMunMedia(munId, {
        kind: slot.kind,
        contentType: file.type as MunImageContentType,
        fileBase64: await readFileAsBase64(file),
      }),
    onSuccess: async () => {
      await refresh();
      toast.success(`${slot.title} uploaded`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : `Unable to upload ${slot.title.toLowerCase()}`),
    onSettled: () => {
      if (inputRef.current) inputRef.current.value = "";
    },
  });

  const removeMutation = useMutation({
    mutationFn: (mediaId: string) => deleteMunMedia(mediaId),
    onSuccess: async () => {
      await refresh();
      toast.success(`${slot.title} removed`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : `Unable to remove ${slot.title.toLowerCase()}`),
  });

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type as MunImageContentType)) {
      toast.error("Use a PNG, JPEG or WebP image");
      input.value = "";
      return;
    }
    if (file.size > slot.maxBytes) {
      toast.error(`${slot.title} must be ${slot.maxLabel} or smaller`);
      input.value = "";
      return;
    }
    if (slot.checkDimensions) {
      let dimensionError: string | null;
      try {
        dimensionError = checkCoverDimensions(await readImageDimensions(file));
      } catch {
        toast.error("Couldn't read this image — try a different file");
        input.value = "";
        return;
      }
      if (dimensionError) {
        toast.error(dimensionError);
        input.value = "";
        return;
      }
    }
    uploadMutation.mutate(file);
  };

  const busy = uploadMutation.isPending || removeMutation.isPending;

  return (
    <section className="flex flex-col gap-sm" aria-label={slot.title} data-testid={`branding-${slot.kind}`}>
      <h3 className="text-body-md font-medium text-ink">{slot.title}</h3>
      {loading ? (
        <Skeleton className={cn("rounded-md", slot.previewClass)} />
      ) : current ? (
        <img
          src={current.url}
          alt={`Current ${slot.title.toLowerCase()}`}
          className={cn("rounded-md border border-border bg-surface-soft object-cover", slot.previewClass)}
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center rounded-md border border-dashed border-border bg-surface-soft text-muted-foreground",
            slot.previewClass,
          )}
        >
          <ImageIcon className="size-6" aria-hidden />
          <span className="sr-only">No {slot.title.toLowerCase()} yet</span>
        </div>
      )}
      <p className="max-w-sm text-caption text-muted-foreground">{slot.hint}</p>
      <label htmlFor={inputId} className="sr-only">
        {slot.inputLabel}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="sr-only"
        onChange={handleFile}
        disabled={busy}
      />
      <div className="flex flex-wrap gap-xs">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload aria-hidden />
          {uploadMutation.isPending ? "Uploading..." : current ? `Replace ${slot.title.toLowerCase()}` : `Upload ${slot.title.toLowerCase()}`}
        </Button>
        {current && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Remove your ${slot.title.toLowerCase()}? You'll need one to go live.`)) {
                removeMutation.mutate(current.id);
              }
            }}
          >
            <Trash2 aria-hidden />
            Remove
          </Button>
        )}
      </div>
    </section>
  );
}
