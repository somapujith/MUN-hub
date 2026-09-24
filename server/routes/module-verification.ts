import { Hono } from 'hono'
import { z } from 'zod'
import {
  bulkVerifyModules,
  confirmModule,
  getModuleVerificationState,
  reviewModule,
  setModuleRequirement,
} from '@/lib/lifecycle/module-verification'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
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

const bulkVerifyModulesBodySchema = z
  .object({
    targets: z
      .array(
        z
          .object({
            munId: z.string().min(1),
            moduleName: moduleNameSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()

export const moduleVerificationRoutes = new Hono<{ Variables: AppVariables }>()

// Bulk verify-only (Gate 2). Not nested under a single mun's routes below —
// a batch spans multiple munId/moduleName pairs at once.
moduleVerificationRoutes.post(
  '/admin/modules/bulk-verify',
  requireAuth,
  requireRole([...REVIEW_ROLES]),
  zValidator('json', bulkVerifyModulesBodySchema),
  async (c) => {
    const { targets } = c.req.valid('json')
    const results = await bulkVerifyModules(targets, c.get('session'))
    return c.json({ results })
  },
)

// Reviewers can read any mun's module state; an organizer only their own mun's.
// Was unauthenticated, which let anyone read review state by mun id — and
// since getModuleVerificationState lazily inserts a row, write to the DB too.
moduleVerificationRoutes.get('/muns/:munId/modules/:moduleName', requireAuth, async (c) => {
  const moduleName = moduleNameSchema.parse(c.req.param('moduleName'))
  const munId = c.req.param('munId')
  const session = c.get('session')!
  if (!(REVIEW_ROLES as readonly string[]).includes(session.role)) {
    await assertOwnsOrAdmin(munId, session)
  }
  const state = await getModuleVerificationState(munId, moduleName)
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
