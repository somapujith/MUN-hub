import { describe, expect, it } from 'vitest'
import { mapThrownError } from '@/server/middleware/error'
import { SAMPLE_FILES, paddedFile } from './in-memory-bindings'
import { detectContentType, UPLOAD_RULES, UploadValidationError, validateUpload } from './validate'

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
  it('accepts each image type for logos, covers and gallery images', () => {
    for (const purpose of ['LOGO', 'COVER', 'IMAGE'] as const) {
      expect(() => validateUpload(SAMPLE_FILES.png, 'image/png', purpose)).not.toThrow()
      expect(() => validateUpload(SAMPLE_FILES.jpeg, 'image/jpeg', purpose)).not.toThrow()
      expect(() => validateUpload(SAMPLE_FILES.webp, 'image/webp', purpose)).not.toThrow()
    }
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
      { purpose: 'COVER', header: SAMPLE_FILES.jpeg, type: 'image/jpeg', max: 5 * MB, label: '5MB' },
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
