import { zValidator as baseZValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono/types'
import type { ZodSchema } from 'zod'

/** zValidator that throws ZodError on failure so errorHandler maps to VALIDATION_FAILED. */
export function zValidator<T extends ZodSchema>(
  target: keyof ValidationTargets,
  schema: T,
) {
  return baseZValidator(target, schema, (result) => {
    if (!result.success) {
      throw result.error
    }
  })
}
