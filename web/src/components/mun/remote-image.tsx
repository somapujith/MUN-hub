import { useState, type ReactNode } from "react";

/**
 * An organizer-uploaded image. Stored URLs can be unreachable (the mock
 * storage adapter returns paths nothing serves), so a failed load renders the
 * fallback instead of a broken-image icon.
 */
export function RemoteImage({
  src,
  alt,
  className,
  fallback = null,
  loading = "lazy",
  fetchPriority,
}: {
  src: string;
  alt: string;
  className?: string;
  fallback?: ReactNode;
  loading?: "lazy" | "eager";
  /**
   * Hints the browser to fetch this image before other same-priority
   * resources — reserve "high" for the single largest above-the-fold image
   * on a page (an LCP candidate), never for a lazy-loaded one.
   */
  fetchPriority?: "high" | "low" | "auto";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      className={className}
      onError={() => setFailedSrc(src)}
    />
  );
}
