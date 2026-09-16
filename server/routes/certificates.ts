import { Hono } from 'hono'
import { listCertificates } from '@/lib/actions/certificates'
import { requireAuth } from '../middleware/require-auth'
import type { AppVariables } from '../src/types'

/**
 * Read-only wrapper around `lib/actions/certificates.ts#listCertificates`.
 * No create/update/delete routes — see that file's header comment for why
 * this stays list-only (certificates are schema-scaffolded, no MVP logic).
 */
export const certificatesRoutes = new Hono<{ Variables: AppVariables }>()

certificatesRoutes.get('/muns/:munId/certificates', requireAuth, async (c) => {
  const items = await listCertificates(c.req.param('munId'), c.get('session'))
  return c.json(items)
})
