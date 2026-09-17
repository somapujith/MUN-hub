export type MunMediaKind = "LOGO" | "COVER" | "GALLERY" | "SPONSOR" | "ORGANIZER_LOGO";

export type MunImageContentType = "image/png" | "image/jpeg" | "image/webp";

/** One row of `GET /muns/:munId/media` (lib/actions/mun-branding.ts#MunMediaItem). */
export interface MunMediaItem {
  id: string;
  munId: string;
  kind: MunMediaKind;
  url: string;
  contentType: string;
  sizeBytes: number;
  displayOrder: number;
  createdAt: string;
}

/** Body of `POST /muns/:munId/media` (server/routes/mun-branding.ts, `.strict()`). */
export interface UploadMunMediaInput {
  kind: MunMediaKind;
  contentType: MunImageContentType;
  /** Raw base64 payload (no "data:...;base64," prefix). */
  fileBase64: string;
  displayOrder?: number;
}
