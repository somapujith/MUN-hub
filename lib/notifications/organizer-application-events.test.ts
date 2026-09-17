import { describe, expect, it, vi } from 'vitest'
import { notifyOrganizerApplicationEvent, renderOrganizerApplicationNotification } from './organizer-application-events'
import type { NotificationsAdapter } from './adapter'

describe('renderOrganizerApplicationNotification', () => {
  it('renders APPLICATION_APPROVED to the organizer', () => {
    const result = renderOrganizerApplicationNotification({
      type: 'APPLICATION_APPROVED',
      munId: 'mun-1',
      organizerEmail: 'org@test.dev',
      munName: 'Oxford MUN 2027',
    })
    expect(result.to).toBe('org@test.dev')
    expect(result.subject).toContain('Oxford MUN 2027')
    expect(result.body).toContain('approved')
  })

  it('renders APPLICATION_CHANGES_REQUESTED with the reason', () => {
    const result = renderOrganizerApplicationNotification({
      type: 'APPLICATION_CHANGES_REQUESTED',
      munId: 'mun-2',
      organizerEmail: 'org@test.dev',
      munName: 'VIT MUN',
      reason: 'Please provide a valid venue address',
    })
    expect(result.body).toContain('Please provide a valid venue address')
  })

  it('renders APPLICATION_REJECTED with the reason', () => {
    const result = renderOrganizerApplicationNotification({
      type: 'APPLICATION_REJECTED',
      munId: 'mun-3',
      organizerEmail: 'org@test.dev',
      munName: 'BITSMUN',
      reason: 'Does not meet platform criteria',
    })
    expect(result.body).toContain('Does not meet platform criteria')
    expect(result.body).toContain('not approved')
  })

  it('never reuses PipelineEvent\'s Gate-2 type literals (APPROVED/CHANGES_REQUESTED)', () => {
    const approved = renderOrganizerApplicationNotification({
      type: 'APPLICATION_APPROVED',
      munId: 'mun-1',
      organizerEmail: 'org@test.dev',
      munName: 'X',
    })
    // Regression guard: the event's own `type` discriminant must never
    // collide with pipeline-events.ts's 'APPROVED'/'CHANGES_REQUESTED' —
    // this test only checks the rendered subject/body don't accidentally
    // read as a Gate-2 notice; the type-level guarantee is enforced by
    // TypeScript's discriminated union already rejecting a wrong literal.
    expect(approved.subject).not.toContain('is live')
  })
})

describe('notifyOrganizerApplicationEvent', () => {
  it('sends via the given adapter and never throws on delivery failure', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network down'))
    const adapter: NotificationsAdapter = { send }

    await expect(
      notifyOrganizerApplicationEvent(
        { type: 'APPLICATION_REJECTED', munId: 'mun-1', organizerEmail: 'org@test.dev', munName: 'X', reason: 'no' },
        adapter,
      ),
    ).resolves.toBeUndefined()

    expect(send).toHaveBeenCalledWith({
      to: 'org@test.dev',
      subject: expect.stringContaining('X'),
      body: expect.stringContaining('no'),
    })
  })
})
