/**
 * Client-side mirror of the cover-image aspect ratio rule enforced
 * server-side in lib/storage/validate.ts's UPLOAD_RULES.COVER
 * (requiredAspectRatio/minWidth/minHeight). Keep these two in sync —
 * web/ has no build-time access to the root lib/ package (it talks to the
 * API over HTTP), so the constants are duplicated rather than imported.
 * This check exists to reject a bad file before it leaves the browser; the
 * server check is still the one that actually enforces it.
 */
export const COVER_REQUIRED_RATIO = { width: 25, height: 6 } as const;
export const COVER_MIN_WIDTH = 2000;
export const COVER_MIN_HEIGHT = 480;

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Decodes `file` just far enough to read its pixel dimensions. */
export function readImageDimensions(file: File): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read this image's dimensions"));
    };
    img.src = url;
  });
}

/**
 * Same rule as the server's assertAspectRatio: exact integer ratio match
 * (cross-multiplication, no floating-point rounding), any multiple of the
 * ratio at or above the floor passes. Returns a user-facing message, or null
 * if the dimensions are acceptable.
 */
export function checkCoverDimensions({ width, height }: ImageDimensions): string | null {
  const matchesRatio = width * COVER_REQUIRED_RATIO.height === height * COVER_REQUIRED_RATIO.width;
  if (!matchesRatio) {
    return `Image is ${width}x${height} — this image must be ${COVER_REQUIRED_RATIO.width}:${COVER_REQUIRED_RATIO.height} (e.g. ${COVER_MIN_WIDTH}x${COVER_MIN_HEIGHT})`;
  }
  if (width < COVER_MIN_WIDTH || height < COVER_MIN_HEIGHT) {
    return `Image is ${width}x${height} — minimum size is ${COVER_MIN_WIDTH}x${COVER_MIN_HEIGHT}`;
  }
  return null;
}
