import { describe, expect, it } from 'vitest'
import { mapThrownError } from '@/server/middleware/error'
import { SAMPLE_FILES, paddedFile } from './in-memory-bindings'
import {
  detectContentType,
  largestUploadBytes,
  maxBase64Length,
  readImageDimensions,
  UPLOAD_RULES,
  UploadValidationError,
  validateUpload,
} from './validate'

/**
 * Real, minimal PNGs at exact pixel dimensions (valid IHDR + a tiny deflated
 * IDAT + IEND, generated once and pinned as base64 — not decodable as a real
 * photo, but a real PNG a header parser reads correctly). Unlike
 * SAMPLE_FILES.png (a genuine 1x1 pixel image, used only for content-type
 * detection), these exist to exercise readImageDimensions/the cover aspect
 * ratio check at the exact boundary values Slice: banner-dimensions cares
 * about.
 */
const DIMENSION_PNGS = {
  // Exactly the required 2000x480, 25:6.
  cover2000x480: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAB9AAAAHgCAIAAABy8GG5AAAAHUlEQVR4nO3BMQEAAADCoPVPbQhfoAAAAAAAgNsAF3EAAW1SnXoAAAAASUVORK5CYII=',
    'base64',
  ),
  // A 2x multiple of the same ratio: 4000x960.
  cover4000x960: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAD6AAAAPACAIAAACuSRF7AAAAI0lEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAA4MAALuEAAc/gZwAAAAAASUVORK5CYII=',
    'base64',
  ),
  // 16:9, not 25:6 — the ratio the old (wrong) preview assumed.
  wrongRatio1600x900: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAABkAAAAOECAIAAAB2L2r1AAAAHElEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAADg2AASwQABIlV0XAAAAABJRU5ErkJggg==',
    'base64',
  ),
  // Correct 25:6 ratio, but under the 2000x480 floor.
  tooSmall1000x240: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAA+gAAADwCAIAAAAcrNnYAAAAGklEQVR4nO3BMQEAAADCoPVPbQ0PoAAAgHsDC7kAAfTKO28AAAAASUVORK5CYII=',
    'base64',
  ),
} as const

const MB = 1024 * 1024

function errorFrom(fn: () => void): Error {
  try {
    fn()
  } catch (error) {
    return error as Error
  }
  throw new Error('expected a throw')
}

describe('detectContentType', () => {
  it('recognises the four allowed signatures', () => {
    expect(detectContentType(SAMPLE_FILES.png)).toBe('image/png')
    expect(detectContentType(SAMPLE_FILES.jpeg)).toBe('image/jpeg')
    expect(detectContentType(SAMPLE_FILES.webp)).toBe('image/webp')
    expect(detectContentType(SAMPLE_FILES.pdf)).toBe('application/pdf')
  })

  it('returns null for HTML, SVG, GIF, empty and truncated input', () => {
    expect(detectContentType(SAMPLE_FILES.html)).toBeNull()
    expect(detectContentType(SAMPLE_FILES.svg)).toBeNull()
    expect(detectContentType(SAMPLE_FILES.gif)).toBeNull()
    expect(detectContentType(new Uint8Array())).toBeNull()
    expect(detectContentType(SAMPLE_FILES.png.subarray(0, 4))).toBeNull()
    expect(detectContentType(Buffer.from('%PDF'))).toBeNull()
  })

  it('does not treat other RIFF files (WAV) as WebP', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')])
    expect(detectContentType(wav)).toBeNull()
    expect(detectContentType(Buffer.from('RIFF\0\0\0\0WEB'))).toBeNull()
  })

  it('only matches a PDF header at the very start', () => {
    expect(detectContentType(Buffer.from(' %PDF-1.4'))).toBeNull()
    expect(detectContentType(Buffer.from('<html>%PDF-1.4'))).toBeNull()
  })
})

describe('validateUpload', () => {
  it('accepts each image type for logos and gallery images (no aspect ratio requirement)', () => {
    for (const purpose of ['LOGO', 'IMAGE'] as const) {
      expect(() => validateUpload(SAMPLE_FILES.png, 'image/png', purpose)).not.toThrow()
      expect(() => validateUpload(SAMPLE_FILES.jpeg, 'image/jpeg', purpose)).not.toThrow()
      expect(() => validateUpload(SAMPLE_FILES.webp, 'image/webp', purpose)).not.toThrow()
    }
  })

  it('accepts a cover image that is a real PNG at the required 25:6 ratio', () => {
    // COVER additionally requires a readable, correctly-proportioned image
    // (see the dedicated aspect-ratio describe block below) — SAMPLE_FILES'
    // jpeg/webp fixtures are truncated headers with no real dimensions and
    // are intentionally not asserted against COVER here.
    expect(() => validateUpload(DIMENSION_PNGS.cover2000x480, 'image/png', 'COVER')).not.toThrow()
  })

  it('accepts a PDF document', () => {
    expect(() => validateUpload(SAMPLE_FILES.pdf, 'application/pdf', 'DOCUMENT')).not.toThrow()
  })

  it('rejects SVG and HTML content types outright', () => {
    expect(() => validateUpload(SAMPLE_FILES.svg, 'image/svg+xml', 'LOGO')).toThrow(
      'Unsupported content type "image/svg+xml" — allowed types are image/png, image/jpeg, image/webp',
    )
    expect(() => validateUpload(SAMPLE_FILES.html, 'text/html', 'DOCUMENT')).toThrow(
      'Unsupported content type "text/html" — allowed types are application/pdf',
    )
  })

  it('rejects a PDF uploaded as an image and an image uploaded as a document', () => {
    expect(() => validateUpload(SAMPLE_FILES.pdf, 'application/pdf', 'COVER')).toThrow(/^Unsupported content type/)
    expect(() => validateUpload(SAMPLE_FILES.png, 'image/png', 'DOCUMENT')).toThrow(/^Unsupported content type/)
  })

  it('rejects HTML or SVG bytes declared as an image', () => {
    expect(() => validateUpload(SAMPLE_FILES.html, 'image/png', 'LOGO')).toThrow(
      "The file's contents do not match its declared type (image/png) — a valid PNG image is required",
    )
    expect(() => validateUpload(SAMPLE_FILES.svg, 'image/webp', 'IMAGE')).toThrow(/do not match its declared type/)
  })

  it('rejects an allowed type whose bytes are a different allowed type', () => {
    expect(() => validateUpload(SAMPLE_FILES.png, 'image/jpeg', 'LOGO')).toThrow(
      "The file's contents do not match its declared type (image/jpeg) — a valid JPEG image is required",
    )
    expect(() => validateUpload(SAMPLE_FILES.html, 'application/pdf', 'DOCUMENT')).toThrow(
      "The file's contents do not match its declared type (application/pdf) — a valid PDF document is required",
    )
  })

  it('rejects an empty file', () => {
    expect(() => validateUpload(Buffer.alloc(0), 'image/png', 'LOGO')).toThrow(
      'The file is empty — a non-empty file is required',
    )
  })

  it('enforces the size caps: logo 2MB, cover and gallery 5MB, documents 10MB', () => {
    expect(UPLOAD_RULES.LOGO.maxBytes).toBe(2 * MB)
    expect(UPLOAD_RULES.COVER.maxBytes).toBe(5 * MB)
    expect(UPLOAD_RULES.IMAGE.maxBytes).toBe(5 * MB)
    expect(UPLOAD_RULES.DOCUMENT.maxBytes).toBe(10 * MB)

    const cases = [
      { purpose: 'LOGO', header: SAMPLE_FILES.png, type: 'image/png', max: 2 * MB, label: '2MB' },
      // COVER needs a real, correctly-proportioned PNG here (not the jpeg
      // fixture used elsewhere) since padding now runs the aspect-ratio
      // check too — padding after a valid IHDR is harmless, the IDAT stream
      // just becomes invalid, which readImageDimensions never inspects.
      { purpose: 'COVER', header: DIMENSION_PNGS.cover2000x480, type: 'image/png', max: 5 * MB, label: '5MB' },
      { purpose: 'IMAGE', header: SAMPLE_FILES.webp, type: 'image/webp', max: 5 * MB, label: '5MB' },
      { purpose: 'DOCUMENT', header: SAMPLE_FILES.pdf, type: 'application/pdf', max: 10 * MB, label: '10MB' },
    ] as const
    for (const { purpose, header, type, max, label } of cases) {
      expect(() => validateUpload(paddedFile(header, max), type, purpose)).not.toThrow()
      expect(() => validateUpload(paddedFile(header, max + 1), type, purpose)).toThrow(
        `File too large (${max + 1} bytes) — maximum allowed size is ${label}`,
      )
    }
  })

  it('checks the size before the contents, so an oversized non-image reports its size', () => {
    expect(() => validateUpload(Buffer.alloc(2 * MB + 1), 'image/png', 'LOGO')).toThrow(/^File too large/)
  })

  it('throws UploadValidationError', () => {
    expect(errorFrom(() => validateUpload(SAMPLE_FILES.html, 'image/png', 'LOGO'))).toBeInstanceOf(
      UploadValidationError,
    )
  })

  it('produces messages the API error handler maps to 400 VALIDATION_FAILED', () => {
    const failures = [
      () => validateUpload(SAMPLE_FILES.svg, 'image/svg+xml', 'LOGO'),
      () => validateUpload(SAMPLE_FILES.html, 'text/html', 'DOCUMENT'),
      () => validateUpload(SAMPLE_FILES.html, 'image/png', 'LOGO'),
      () => validateUpload(SAMPLE_FILES.png, 'application/pdf', 'DOCUMENT'),
      () => validateUpload(Buffer.alloc(0), 'image/webp', 'COVER'),
      () => validateUpload(paddedFile(SAMPLE_FILES.pdf, 10 * MB + 1), 'application/pdf', 'DOCUMENT'),
    ]
    for (const fail of failures) {
      const error = errorFrom(fail)
      const mapped = mapThrownError(error)
      expect(mapped, error.message).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', message: error.message })
    }
  })
})

describe('readImageDimensions', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    expect(readImageDimensions(DIMENSION_PNGS.cover2000x480, 'image/png')).toEqual({ width: 2000, height: 480 })
    expect(readImageDimensions(DIMENSION_PNGS.cover4000x960, 'image/png')).toEqual({ width: 4000, height: 960 })
  })

  it('returns null for a content type it does not know how to read', () => {
    expect(readImageDimensions(SAMPLE_FILES.pdf, 'application/pdf')).toBeNull()
  })

  it('returns null for bytes too short to contain a header', () => {
    expect(readImageDimensions(Buffer.alloc(4), 'image/png')).toBeNull()
  })
})

describe('validateUpload — cover aspect ratio (25:6, minimum 2000x480)', () => {
  it('accepts exactly 2000x480', () => {
    expect(() => validateUpload(DIMENSION_PNGS.cover2000x480, 'image/png', 'COVER')).not.toThrow()
  })

  it('accepts a higher-resolution multiple of the same ratio (4000x960)', () => {
    expect(() => validateUpload(DIMENSION_PNGS.cover4000x960, 'image/png', 'COVER')).not.toThrow()
  })

  it('rejects a 16:9 image even if it is otherwise a valid PNG', () => {
    expect(() => validateUpload(DIMENSION_PNGS.wrongRatio1600x900, 'image/png', 'COVER')).toThrow(
      'Image is 1600x900 — this image must be 25:6 (e.g. 2000x480)',
    )
  })

  it('rejects a correctly-proportioned image below the size floor', () => {
    expect(() => validateUpload(DIMENSION_PNGS.tooSmall1000x240, 'image/png', 'COVER')).toThrow(
      'Image is 1000x240 — minimum size is 2000x480',
    )
  })

  it('does not apply the aspect ratio check to LOGO or IMAGE purposes', () => {
    // wrongRatio1600x900 would fail COVER's ratio check but LOGO has no such
    // rule — it should only be judged on type/size/contents like before.
    expect(() => validateUpload(DIMENSION_PNGS.wrongRatio1600x900, 'image/png', 'LOGO')).not.toThrow()
    expect(() => validateUpload(DIMENSION_PNGS.wrongRatio1600x900, 'image/png', 'IMAGE')).not.toThrow()
  })
})

describe('base64 sizing helpers', () => {
  it('maxBase64Length matches what Buffer produces for a file of that size', () => {
    for (const size of [0, 1, 2, 3, 4, 2 * MB, 5 * MB, 10 * MB]) {
      expect(maxBase64Length(size), String(size)).toBe(Buffer.alloc(size).toString('base64').length)
    }
  })

  it('largestUploadBytes picks the biggest cap among the given purposes', () => {
    expect(largestUploadBytes()).toBe(10 * MB)
    expect(largestUploadBytes(['LOGO', 'COVER', 'IMAGE'])).toBe(5 * MB)
    expect(largestUploadBytes(['LOGO'])).toBe(UPLOAD_RULES.LOGO.maxBytes)
  })
})
