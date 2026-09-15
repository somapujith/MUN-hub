import { Hono } from 'hono'
import { z } from 'zod'
import {
  confirmModule,
  getModuleVerificationState,
  reviewModule,
  setModuleRequirement,
} from '@/lib/lifecycle/module-verification'
import { munModuleEnum, verificationSeverityEnum } from '@/lib/db/schema-enums'
import { zValidator } from '../lib/zod-validator'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import type { AppVariables } from '../src/types'

const REVIEW_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const
const REQUIREMENT_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const

const moduleNameSchema = z.enum(munModuleEnum.enumValues)

const reviewModuleBodySchema = z
  .object({
    decision: z.enum(['VERIFIED', 'CHANGES_REQUESTED', 'REJECTED']),
    issues: z
      .array(
        z
          .object({
            severity: z.enum(verificationSeverityEnum.enumValues),
            reason: z.string().min(1),
            previousValue: z.string().optional(),
            newValue: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()

const setRequirementBodySchema = z
  .object({
    isRequired: z.boolean(),
  })
  .strict()

export const moduleVerificationRoutes = new Hono<{ Variables: AppVariables }>()

moduleVerificationRoutes.get('/muns/:munId/modules/:moduleName', async (c) => {
  const moduleName = moduleNameSchema.parse(c.req.param('moduleName'))
  const state = await getModuleVerificationState(c.req.param('munId'), moduleName)
  return c.json(state)
})

moduleVerificationRoutes.post(
  '/muns/:munId/modules/:moduleName/actions/confirm',
  requireAuth,
  async (c) => {
    const moduleName = moduleNameSchema.parse(c.req.param('moduleName'))
    const state = await confirmModule(c.req.param('munId'), moduleName, c.get('session'))
    return c.json(state, 200)
  },
)

moduleVerificationRoutes.post(
  '/muns/:munId/modules/:moduleName/actions/review',
  requireAuth,
  requireRole([...REVIEW_ROLES]),
  zValidator('json', reviewModuleBodySchema),
  async (c) => {
    const moduleName = moduleNameSchema.parse(c.req.param('moduleName'))
    const body = c.req.valid('json')
    const state = await reviewModule(
      c.req.param('munId'),
      moduleName,
      body.decision,
      body.issues,
      c.get('session'),
    )
    return c.json(state, 200)
  },
)

moduleVerificationRoutes.patch(
  '/muns/:munId/modules/:moduleName/requirement',
  requireAuth,
  requireRole([...REQUIREMENT_ROLES]),
  zValidator('json', setRequirementBodySchema),
  async (c) => {
    const moduleName = moduleNameSchema.parse(c.req.param('moduleName'))
    const body = c.req.valid('json')
    const state = await setModuleRequirement(
      c.req.param('munId'),
      moduleName,
      body.isRequired,
      c.get('session'),
    )
    return c.json(state, 200)
  },
)
