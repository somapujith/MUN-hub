// -----------------------------------------------------------------------------
// Upload validation — runs before any byte reaches storage
// -----------------------------------------------------------------------------
//
// Three checks, in order:
//   1. the declared content type is on the allowlist for this kind of upload
//   2. the file is not empty and not over the size cap
//   3. the file's first bytes (its "magic number") match the declared type
//
// Check 3 is what stops an HTML or SVG page from being uploaded with a
// declared type of image/png: the files route serves the declared type, so
// the declared type must be true. SVG, HTML, GIF and everything else have no
// entry in the allowlist and are rejected.
//
// Error messages are phrased to match patterns server/middleware/error.ts
// already maps to 400 VALIDATION_FAILED:
//   "Unsupported content type "…" — allowed types are …"
//   "File too large (N bytes) — maximum allowed size is …"
//   "… is required"  (empty file, contents that don't match the type)
// lib/storage/validate.test.ts pins that mapping.

export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const DOCUMENT_CONTENT_TYPES = ['application/pdf'] as const

export type AllowedContentType = (typeof IMAGE_CONTENT_TYPES)[number] | (typeof DOCUMENT_CONTENT_TYPES)[number]

const MB = 1024 * 1024

/**
 * Upload kinds and their limits. Where the older per-action limits
 * (images 5MB, documents 20MB) and the go-live requirements differed, the
 * stricter one wins: logos 2MB, covers and gallery images 5MB, documents
 * 10MB. The 10MB document cap also keeps a base64 JSON upload well inside a
 * Worker's 128MB memory limit.
 */
export const UPLOAD_RULES = {
  LOGO: { contentTypes: IMAGE_CONTENT_TYPES, maxBytes: 2 * MB, maxLabel: '2MB' },
  COVER: { contentTypes: IMAGE_CONTENT_TYPES, maxBytes: 5 * MB, maxLabel: '5MB' },
  IMAGE: { contentTypes: IMAGE_CONTENT_TYPES, maxBytes: 5 * MB, maxLabel: '5MB' },
  DOCUMENT: { contentTypes: DOCUMENT_CONTENT_TYPES, maxBytes: 10 * MB, maxLabel: '10MB' },
} as const

export type UploadPurpose = keyof typeof UPLOAD_RULES

/**
 * Length of the standard base64 encoding (padded, no line breaks) of a
 * `bytes`-byte file. The upload routes cap `fileBase64` with this so an
 * oversized body is rejected by the schema, before the handler decodes it —
 * the byte cap alone is only checked after a Buffer has already been
 * allocated, which is too late to protect the isolate's memory.
 */
export function maxBase64Length(bytes: number): number {
  return 4 * Math.ceil(bytes / 3)
}

/** The largest byte cap among `purposes` — what an upload route accepting them has to allow. */
export function largestUploadBytes(purposes: readonly UploadPurpose[] = Object.keys(UPLOAD_RULES) as UploadPurpose[]): number {
  return Math.max(...purposes.map((purpose) => UPLOAD_RULES[purpose].maxBytes))
}

const DESCRIPTIONS: Record<AllowedContentType, string> = {
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
  'image/webp': 'WebP image',
  'application/pdf': 'PDF document',
}

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadValidationError'
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false
  return signature.every((value, index) => bytes[offset + index] === value)
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] // RIFF
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50] // WEBP, at offset 8

/** The allowed content type these bytes actually are, or null if they are none of them. */
export function detectContentType(bytes: Uint8Array): AllowedContentType | null {
  if (startsWith(bytes, PDF_SIGNATURE)) return 'application/pdf'
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png'
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg'
  if (startsWith(bytes, RIFF_SIGNATURE) && startsWith(bytes, WEBP_SIGNATURE, 8)) return 'image/webp'
  return null
}

/** Throws UploadValidationError unless `file` is an acceptable upload of the declared type for `purpose`. */
export function validateUpload(file: Uint8Array, contentType: string, purpose: UploadPurpose): void {
  const rule = UPLOAD_RULES[purpose]
  const allowed: readonly string[] = rule.contentTypes

  if (!allowed.includes(contentType)) {
    throw new UploadValidationError(
      `Unsupported content type "${contentType}" — allowed types are ${allowed.join(', ')}`,
    )
  }
  if (file.byteLength === 0) {
    throw new UploadValidationError('The file is empty — a non-empty file is required')
  }
  if (file.byteLength > rule.maxBytes) {
    throw new UploadValidationError(
      `File too large (${file.byteLength} bytes) — maximum allowed size is ${rule.maxLabel}`,
    )
  }
  if (detectContentType(file) !== contentType) {
    const expected = DESCRIPTIONS[contentType as AllowedContentType]
    throw new UploadValidationError(
      `The file's contents do not match its declared type (${contentType}) — a valid ${expected} is required`,
    )
  }
}
