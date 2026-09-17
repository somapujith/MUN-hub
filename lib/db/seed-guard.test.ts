import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSeedTargetIsLocal } from './seed-guard'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('assertSeedTargetIsLocal', () => {
  it.each([
    'postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub',
    'postgres://user:pass@127.0.0.1/db',
    'postgres://user:pass@LOCALHOST:5432/db',
    'postgres://user:pass@[::1]:5432/db',
    'postgres://user@localhost/db?host=/var/run/postgresql',
  ])('allows %s', (url) => {
    expect(() => assertSeedTargetIsLocal(url, false)).not.toThrow()
  })

  it.each([
    'postgresql://user:pass@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
    'postgres://user:pass@db.internal:5432/db',
    'postgres://user:pass@10.0.0.5/db',
    'postgres://user:pass@localhost.evil.example/db',
    'postgres://user:pass@localhost/db?host=prod-db.example.com',
    'postgres://user:pass@localhost,prod-db.example.com/db',
  ])('refuses %s', (url) => {
    expect(() => assertSeedTargetIsLocal(url, false)).toThrow(/Refusing to seed/)
  })

  it('refuses a missing or unparseable DATABASE_URL', () => {
    expect(() => assertSeedTargetIsLocal(undefined, false)).toThrow(/not set/)
    expect(() => assertSeedTargetIsLocal('not a url', false)).toThrow(/not a valid URL/)
    expect(() => assertSeedTargetIsLocal('postgresql:///mun_hub', false)).toThrow(/no host/)
  })

  it('names the remote host and the escape hatch in the error', () => {
    expect(() => assertSeedTargetIsLocal('postgres://u:p@prod-db.example.com/db', false)).toThrow(
      /prod-db\.example\.com.*ALLOW_REMOTE_SEED=true/,
    )
  })

  it('allows any target when ALLOW_REMOTE_SEED is set, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => assertSeedTargetIsLocal('postgres://u:p@prod-db.example.com/db', true)).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })
})
