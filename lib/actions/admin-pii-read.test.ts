import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordPiiRead } from './admin-pii-read'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recordPiiRead', () => {
  it('emits one structured pii_read line', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const now = new Date('2026-09-17T08:00:00.000Z')

    const line = recordPiiRead(
      { actorId: 'staff-1', route: 'GET /admin/registrations', targetType: 'registration', targetIds: ['r1', 'r2'], hasQuery: true },
      now,
    )

    expect(info).toHaveBeenCalledTimes(1)
    expect(JSON.parse(info.mock.calls[0][0] as string)).toEqual({
      event: 'pii_read',
      actorId: 'staff-1',
      route: 'GET /admin/registrations',
      targetType: 'registration',
      targetId: null,
      targetIds: ['r1', 'r2'],
      count: 2,
      hasQuery: true,
      at: '2026-09-17T08:00:00.000Z',
    })
    expect(line.count).toBe(2)
  })

  it('sets targetId for a single-record read', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const line = recordPiiRead({ actorId: 'a', route: 'r', targetType: 'registration', targetIds: ['only'], hasQuery: false })
    expect(line.targetId).toBe('only')
  })

  it('never throws when logging fails', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('sink down')
    })
    expect(() =>
      recordPiiRead({ actorId: 'a', route: 'r', targetType: 'registration', targetIds: [], hasQuery: false }),
    ).not.toThrow()
  })
})
