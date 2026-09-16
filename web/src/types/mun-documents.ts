export type MunDocumentKind =
  | "RULES"
  | "CODE_OF_CONDUCT"
  | "REFUND_POLICY"
  | "BROCHURE"
  | "HANDBOOK"
  | "DELEGATE_GUIDE"
  | "POSITION_PAPER"
  | "OTHER";

export interface MunDocument {
  id: string;
  munId: string;
  kind: MunDocumentKind;
  title: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface UploadMunDocumentInput {
  kind: MunDocumentKind;
  title: string;
  /** Server currently only accepts PDFs — see lib/actions/mun-documents.ts. */
  contentType: "application/pdf";
  /** Raw base64 payload (no "data:...;base64," prefix). */
  fileBase64: string;
}
