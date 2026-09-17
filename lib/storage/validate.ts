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
  COVER: {
    contentTypes: IMAGE_CONTENT_TYPES,
    maxBytes: 5 * MB,
    maxLabel: '5MB',
    // The public MUN page's banner slot is a fixed 25:6 strip (2000x480 at
    // 1x) — a 16:9 or square cover crops badly there. Any multiple of the
    // ratio is accepted (a 4000x960 export is fine), never a different
    // ratio or a smaller one.
    requiredAspectRatio: { width: 25, height: 6 },
    minWidth: 2000,
    minHeight: 480,
  },
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

export interface ImageDimensions {
  width: number
  height: number
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)
}

/** Width/height from a PNG's IHDR chunk, which always immediately follows the 8-byte signature. */
function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 24) return null
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) }
}

/**
 * Width/height from a baseline or progressive JPEG's SOF (Start Of Frame)
 * marker. Walks the marker segments from byte 2 (skipping the SOI marker)
 * since dimensions aren't at a fixed offset — arbitrary APPn/EXIF/ICC
 * segments can precede SOF.
 */
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2
  while (offset + 9 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]!
    // SOF0-SOF15 except the DHT/JPG/DAC markers, which aren't frame headers.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return { height: readUint16BE(bytes, offset + 5), width: readUint16BE(bytes, offset + 7) }
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2 // markers with no length field
      continue
    }
    const segmentLength = readUint16BE(bytes, offset + 2)
    offset += 2 + segmentLength
  }
  return null
}

/**
 * Width/height from a WebP file. The three sub-formats (simple lossy VP8,
 * simple lossless VP8L, extended VP8X) each encode dimensions differently at
 * a fixed offset past the 12-byte RIFF/WEBP header + 4-byte chunk fourCC.
 */
function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 30) return null
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)
  if (chunk === 'VP8 ') {
    // Lossy: 3-byte frame tag, then a 0x9d012a start code, then 2+2 bytes of
    // 14-bit width/height (top 2 bits of each are a scale factor, masked off).
    return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    // Lossless: a 1-byte signature (0x2f) then a 4-byte bitstream packing
    // 14-bit width-minus-1 and 14-bit height-minus-1, little-endian.
    const bits = readUint32LE(bytes, 21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') {
    // Extended: 4 flag bytes, then 24-bit width-minus-1 and 24-bit
    // height-minus-1, little-endian, 3 bytes each.
    const width = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1
    const height = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1
    return { width, height }
  }
  return null
}

/**
 * Reads an image's pixel dimensions from its header without decoding the
 * full image — safe to run on a Cloudflare Worker (no native image library,
 * no full-image decode cost). Returns null if the format isn't recognised or
 * the bytes are too short to contain a header; callers treat that as "can't
 * verify" rather than assuming any particular size.
 */
export function readImageDimensions(bytes: Uint8Array, contentType: string): ImageDimensions | null {
  if (contentType === 'image/png') return readPngDimensions(bytes)
  if (contentType === 'image/jpeg') return readJpegDimensions(bytes)
  if (contentType === 'image/webp') return readWebpDimensions(bytes)
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

  if ('requiredAspectRatio' in rule) {
    const { requiredAspectRatio, minWidth, minHeight } = rule
    const dimensions = readImageDimensions(file, contentType)
    if (!dimensions) {
      throw new UploadValidationError(
        `Could not read this image's dimensions — a ${requiredAspectRatio.width}:${requiredAspectRatio.height} image at least ${minWidth}x${minHeight}px is required`,
      )
    }
    assertAspectRatio(dimensions, requiredAspectRatio, minWidth, minHeight)
  }
}

/**
 * Throws unless `dimensions` is exactly `ratio.width:ratio.height` (integer
 * cross-multiplication, no floating-point rounding) and at least
 * `minWidth`x`minHeight`. A multiple of the required ratio at a higher
 * resolution passes (e.g. 4000x960 for a 25:6/2000x480 requirement); a
 * different ratio or a smaller image does not.
 */
function assertAspectRatio(
  dimensions: ImageDimensions,
  ratio: { width: number; height: number },
  minWidth: number,
  minHeight: number,
): void {
  const matchesRatio = dimensions.width * ratio.height === dimensions.height * ratio.width
  if (!matchesRatio) {
    throw new UploadValidationError(
      `Image is ${dimensions.width}x${dimensions.height} — this image must be ${ratio.width}:${ratio.height} (e.g. ${minWidth}x${minHeight})`,
    )
  }
  if (dimensions.width < minWidth || dimensions.height < minHeight) {
    throw new UploadValidationError(
      `Image is ${dimensions.width}x${dimensions.height} — minimum size is ${minWidth}x${minHeight}`,
    )
  }
}
