import { describe, expect, it } from 'vitest'
import { requireRole } from './authorize'

describe('requireRole', () => {
  it('passes when role is allowed', () => {
    expect(() => requireRole({ userId: '1', role: 'ADMIN' }, ['ADMIN', 'SUPER_ADMIN'])).not.toThrow()
  })

  it('throws Forbidden when role is not allowed', () => {
    expect(() => requireRole({ userId: '1', role: 'STUDENT' }, ['ADMIN'])).toThrow('Forbidden')
  })

  it('throws Forbidden when session is null', () => {
    expect(() => requireRole(null, ['ADMIN'])).toThrow('Forbidden')
  })
})
