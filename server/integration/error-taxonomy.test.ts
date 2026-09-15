import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { z } from 'zod'
import { KNOWN_ERROR_MAPPINGS, mapThrownError } from '../middleware/error'

describe('error taxonomy mapping', () => {
  it('maps every known lib throw string to its expected status and code', () => {
    for (const { message, status, code } of KNOWN_ERROR_MAPPINGS) {
      const mapped = mapThrownError(new Error(message))
      expect(mapped.status, `status for "${message}"`).toBe(status)
      expect(mapped.code, `code for "${message}"`).toBe(code)
    }
  })

  it('maps ZodError to 400 VALIDATION_FAILED', () => {
    let zodError: ZodError | undefined
    try {
      z.object({ email: z.string().email() }).strict().parse({ email: 'not-an-email' })
    } catch (error) {
      zodError = error as ZodError
    }
    const mapped = mapThrownError(zodError)
    expect(mapped.status).toBe(400)
    expect(mapped.code).toBe('VALIDATION_FAILED')
  })

  it('maps unknown errors to 500 INTERNAL without leaking message', () => {
    const mapped = mapThrownError(new Error('unexpected postgres: SELECT * FROM secrets'))
    expect(mapped.status).toBe(500)
    expect(mapped.code).toBe('INTERNAL')
    expect(mapped.message).toBe('Internal server error')
  })
})
