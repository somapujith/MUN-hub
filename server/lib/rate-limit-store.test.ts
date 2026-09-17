import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getClientIp, rateLimitIpKey } from './rate-limit-store'

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

describe('rateLimitIpKey', () => {
  it('leaves IPv4 addresses and non-addresses alone', () => {
    expect(rateLimitIpKey('198.51.100.20')).toBe('198.51.100.20')
    expect(rateLimitIpKey('unknown')).toBe('unknown')
    expect(rateLimitIpKey('not an address')).toBe('not an address')
  })

  it('groups two addresses in one /64 onto the same key', () => {
    // A VPS is routinely handed a whole /64 (2^64 addresses), so without this
    // it could present a fresh source address per request and start every
    // per-IP limit from zero each time.
    const first = rateLimitIpKey('2001:db8:abcd:0012:0000:0000:0000:0001')
    const second = rateLimitIpKey('2001:db8:abcd:12::beef')
    expect(first).toBe(second)
    expect(first).toBe('2001:db8:abcd:12::/64')
  })

  it('keeps different /64s apart', () => {
    expect(rateLimitIpKey('2001:db8:abcd:12::1')).not.toBe(rateLimitIpKey('2001:db8:abcd:13::1'))
  })

  it('handles compressed, bracketed and zone-suffixed forms', () => {
    expect(rateLimitIpKey('::1')).toBe('0:0:0:0::/64')
    expect(rateLimitIpKey('[2606:4700:3030::6815:5e92]')).toBe('2606:4700:3030:0::/64')
    expect(rateLimitIpKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
  })

  it('leaves an IPv4-mapped address alone (it already names one host)', () => {
    expect(rateLimitIpKey('::ffff:198.51.100.20')).toBe('::ffff:198.51.100.20')
  })
})
