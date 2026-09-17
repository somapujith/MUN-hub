import { Hono } from 'hono'
import { SCHEDULED_JOBS, runScheduledJobs } from '@/lib/jobs/registry'
import { isProductionRuntime } from '@/lib/runtime-platform'
import { getRuntimeEnv } from '@/lib/runtime-env'
import type { AppVariables } from '../src/types'

/**
 * Dev/test-only trigger for the cron jobs (lib/jobs/registry.ts), so local
 * development and the E2E suite can exercise jobs that otherwise only run
 * from the Worker's `scheduled` handler.
 *
 * Doubly gated: ENABLE_DEV_ENDPOINTS=true must be set AND the process must not
 * be a production runtime (Workers, or NODE_ENV=production). Anything else
 * answers 404, exactly like an unknown route.
 *
 *   POST /api/v1/dev/jobs/:name   body (optional): { "scheduledTime": ISO }
 */
export const devJobsRoutes = new Hono<{ Variables: AppVariables }>()

function devEndpointsEnabled(): boolean {
  return getRuntimeEnv('ENABLE_DEV_ENDPOINTS') === 'true' && !isProductionRuntime()
}

devJobsRoutes.post('/dev/jobs/:name', async (c) => {
  if (!devEndpointsEnabled()) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404)
  }

  const job = SCHEDULED_JOBS.find((candidate) => candidate.name === c.req.param('name'))
  if (!job) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Unknown job. Known jobs: ${SCHEDULED_JOBS.map((known) => known.name).join(', ')}`,
        },
      },
      404,
    )
  }

  const body = (await c.req.json().catch(() => ({}))) as { scheduledTime?: unknown }
  let scheduledTime: Date | undefined
  if (typeof body.scheduledTime === 'string') {
    scheduledTime = new Date(body.scheduledTime)
    if (Number.isNaN(scheduledTime.getTime())) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'scheduledTime must be an ISO date' } }, 400)
    }
  }

  const [report] = await runScheduledJobs({ jobs: [job], cron: 'dev-trigger', scheduledTime })
  return c.json(report, report.ok ? 200 : 500)
})
