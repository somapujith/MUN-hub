import { useState } from "react";
import type { GalleryItems } from "@/components/mun/mun-format";

/**
 * Gallery photos and sponsor logos from the organizer's branding module
 * (split and URL-checked by `galleryItems`). A tile whose image fails to load
 * removes itself entirely, so a broken upload never leaves an empty frame.
 */

function Tile({ src, alt, variant }: { src: string; alt: string; variant: "photo" | "sponsor" }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  if (variant === "sponsor") {
    return (
      <li className="flex h-16 w-32 items-center justify-center rounded-md border border-border bg-white p-xs">
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="max-h-full max-w-full object-contain"
        />
      </li>
    );
  }

  return (
    <li className="overflow-hidden rounded-md bg-surface-soft">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="aspect-[4/3] size-full object-cover"
      />
    </li>
  );
}

export function MunGallery({ items, munName }: { items: GalleryItems; munName: string }) {
  const { photos, sponsors } = items;

  return (
    <div className="flex flex-col gap-xl">
      {photos.length > 0 && (
        <ul className="grid list-none grid-cols-2 gap-sm p-0 md:grid-cols-3">
          {photos.map((photo, index) => (
            <Tile key={photo.id} src={photo.url} alt={`${munName} — photo ${index + 1}`} variant="photo" />
          ))}
        </ul>
      )}

      {sponsors.length > 0 && (
        <div>
          <h3 className="text-caption uppercase tracking-[0.16px] text-muted-foreground">Partners & sponsors</h3>
          <ul className="mt-sm flex list-none flex-wrap items-center gap-md p-0">
            {sponsors.map((sponsor, index) => (
              <Tile key={sponsor.id} src={sponsor.url} alt={`Sponsor ${index + 1}`} variant="sponsor" />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
