import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getClientIp } from './rate-limit-store'

const app = new Hono()
app.get('/ip', (c) => c.text(getClientIp(c)))

const SPOOFED = { 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.8' }

afterEach(() => {
  delete process.env.TRUST_PROXY_HEADERS
})

describe('getClientIp', () => {
  describe('over a real Node socket', () => {
    let server: ReturnType<typeof serve>
    let base: string

    beforeAll(async () => {
      await new Promise<void>((resolve) => {
        server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve())
      })
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

    it('uses the socket address and ignores a client-sent X-Forwarded-For', async () => {
      const res = await fetch(`${base}/ip`, { headers: SPOOFED })
      expect(await res.text()).toBe('127.0.0.1')
    })

    it('ignores a client-sent CF-Connecting-IP off Workers', async () => {
      const res = await fetch(`${base}/ip`, { headers: { 'cf-connecting-ip': '203.0.113.9' } })
      expect(await res.text()).toBe('127.0.0.1')
    })

    it('honours the proxy-appended X-Forwarded-For hop only when TRUST_PROXY_HEADERS=true', async () => {
      process.env.TRUST_PROXY_HEADERS = 'true'
      const res = await fetch(`${base}/ip`, { headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.4' } })
      expect(await res.text()).toBe('198.51.100.4')
    })
  })

  it('uses CF-Connecting-IP on Workers (request carries a cf object)', async () => {
    const request = new Request('http://api.test/ip', {
      headers: { 'cf-connecting-ip': '198.51.100.20', ...SPOOFED },
    })
    Object.defineProperty(request, 'cf', { value: { country: 'IN' } })
    const res = await app.fetch(request, {})
    expect(await res.text()).toBe('198.51.100.20')
  })

  it("falls back to 'unknown' when there is no socket (app.request test helper)", async () => {
    const res = await app.request('/ip', { headers: SPOOFED })
    expect(await res.text()).toBe('unknown')
  })
})
