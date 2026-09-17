import { afterEach, describe, expect, it } from 'vitest'
import { setRuntimeEnv } from '@/lib/runtime-env'
import { createApp } from '../src/app'

const app = createApp()
const headers = { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' }

function trigger(name: string, env: Record<string, string>, body: unknown = {}) {
  return app.request(
    `/api/v1/dev/jobs/${name}`,
    { method: 'POST', headers, body: JSON.stringify(body) },
    env,
  )
}

describe('POST /api/v1/dev/jobs/:name', () => {
  afterEach(() => setRuntimeEnv({}))

  it('is a 404 unless ENABLE_DEV_ENDPOINTS=true', async () => {
    const res = await trigger('purgeExpiredAuthArtifacts', {})
    expect(res.status).toBe(404)
  })

  it('is a 404 in a production runtime even when enabled', async () => {
    const res = await trigger('purgeExpiredAuthArtifacts', { ENABLE_DEV_ENDPOINTS: 'true', NODE_ENV: 'production' })
    expect(res.status).toBe(404)
  })

  it('runs a registered job once and returns its report', async () => {
    const res = await trigger('purgeExpiredAuthArtifacts', { ENABLE_DEV_ENDPOINTS: 'true' })
    expect(res.status).toBe(200)
    const report = (await res.json()) as { job: string; ok: boolean }
    expect(report).toMatchObject({ job: 'purgeExpiredAuthArtifacts', ok: true })
  })

  it('names the known jobs for an unknown one and rejects a bad scheduledTime', async () => {
    const unknown = await trigger('nope', { ENABLE_DEV_ENDPOINTS: 'true' })
    expect(unknown.status).toBe(404)
    expect(JSON.stringify(await unknown.json())).toContain('releaseExpiredHolds')

    const bad = await trigger('runOrganizerDigest', { ENABLE_DEV_ENDPOINTS: 'true' }, { scheduledTime: 'not a date' })
    expect(bad.status).toBe(400)
  })
})
