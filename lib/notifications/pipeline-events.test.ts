import { describe, expect, it, vi } from 'vitest'
import { notifyPipelineEvent, renderPipelineNotification, type PipelineEvent } from './pipeline-events'
import type { NotificationsAdapter } from './adapter'

describe('renderPipelineNotification', () => {
  it('renders ONBOARDING_STARTED with organizer email and mun name', () => {
    const event: PipelineEvent = {
      type: 'ONBOARDING_STARTED',
      munId: 'mun-1',
      organizerEmail: 'org@test.dev',
      munName: 'Oxford MUN 2027',
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['org@test.dev'])
    expect(result.subject).toContain('Oxford MUN 2027')
    expect(result.body).toContain('Oxford MUN 2027')
    expect(result.body).toContain('mun-1')
  })

  it('renders MODULE_ACTION_REQUIRED including module name and each issue', () => {
    const event: PipelineEvent = {
      type: 'MODULE_ACTION_REQUIRED',
      munId: 'mun-2',
      organizerEmail: 'org@test.dev',
      munName: 'VIT MUN',
      moduleName: 'Executive Board',
      issues: ['Chair missing', 'Vice-chair missing'],
    }
    const result = renderPipelineNotification(event)
    expect(result.subject).toContain('Executive Board')
    expect(result.body).toContain('Chair missing')
    expect(result.body).toContain('Vice-chair missing')
  })

  it('renders READY_FOR_SUBMISSION', () => {
    const event: PipelineEvent = {
      type: 'READY_FOR_SUBMISSION',
      munId: 'mun-3',
      organizerEmail: 'org@test.dev',
      munName: 'BITSMUN',
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['org@test.dev'])
    expect(result.subject).toContain('BITSMUN')
  })

  it('renders SUBMISSION_RECEIVED', () => {
    const event: PipelineEvent = {
      type: 'SUBMISSION_RECEIVED',
      munId: 'mun-4',
      organizerEmail: 'org@test.dev',
      munName: 'CBITMUN',
    }
    const result = renderPipelineNotification(event)
    expect(result.body).toContain('CBITMUN')
    expect(result.body).toContain('mun-4')
  })

  it('renders UNDER_REVIEW', () => {
    const event: PipelineEvent = {
      type: 'UNDER_REVIEW',
      munId: 'mun-5',
      organizerEmail: 'org@test.dev',
      munName: 'HMUN',
    }
    const result = renderPipelineNotification(event)
    expect(result.subject).toContain('HMUN')
  })

  it('renders CHANGES_REQUESTED with module name and reason', () => {
    const event: PipelineEvent = {
      type: 'CHANGES_REQUESTED',
      munId: 'mun-6',
      organizerEmail: 'org@test.dev',
      munName: 'Vista MUN',
      moduleName: 'Pricing',
      reason: 'Capacity exceeds venue limit',
    }
    const result = renderPipelineNotification(event)
    expect(result.subject).toContain('Pricing')
    expect(result.body).toContain('Capacity exceeds venue limit')
  })

  it('renders APPROVED', () => {
    const event: PipelineEvent = {
      type: 'APPROVED',
      munId: 'mun-7',
      organizerEmail: 'org@test.dev',
      munName: 'St. Francis MUN',
    }
    const result = renderPipelineNotification(event)
    expect(result.subject).toContain('approved')
    expect(result.body).toContain('St. Francis MUN')
  })

  it('renders PUBLISHING', () => {
    const event: PipelineEvent = {
      type: 'PUBLISHING',
      munId: 'mun-8',
      organizerEmail: 'org@test.dev',
      munName: 'M-UN',
    }
    const result = renderPipelineNotification(event)
    expect(result.body).toContain('M-UN')
  })

  it('renders PUBLISHED with the public URL', () => {
    const event: PipelineEvent = {
      type: 'PUBLISHED',
      munId: 'mun-9',
      organizerEmail: 'org@test.dev',
      munName: 'Oxford MUN 2027',
      publicUrl: 'https://munhub.in/mun/oxford-mun-2027',
    }
    const result = renderPipelineNotification(event)
    expect(result.body).toContain('https://munhub.in/mun/oxford-mun-2027')
    expect(result.subject.toLowerCase()).toContain('live')
  })

  it('renders SLA_DELAY', () => {
    const event: PipelineEvent = {
      type: 'SLA_DELAY',
      munId: 'mun-10',
      organizerEmail: 'org@test.dev',
      munName: 'VIT MUN',
    }
    const result = renderPipelineNotification(event)
    expect(result.body).toContain('VIT MUN')
  })

  it('renders NEW_SUBMISSION to all admin emails', () => {
    const event: PipelineEvent = {
      type: 'NEW_SUBMISSION',
      munId: 'mun-11',
      munName: 'Oxford MUN 2027',
      adminEmails: ['admin1@munhub.test', 'admin2@munhub.test'],
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['admin1@munhub.test', 'admin2@munhub.test'])
    expect(result.subject).toContain('Oxford MUN 2027')
  })

  it('renders RESUBMISSION to all admin emails', () => {
    const event: PipelineEvent = {
      type: 'RESUBMISSION',
      munId: 'mun-12',
      munName: 'CBITMUN',
      adminEmails: ['admin1@munhub.test'],
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['admin1@munhub.test'])
    expect(result.subject.toLowerCase()).toContain('resubmission')
  })

  it('renders PAYMENT_VERIFICATION_ISSUE to all admin emails', () => {
    const event: PipelineEvent = {
      type: 'PAYMENT_VERIFICATION_ISSUE',
      munId: 'mun-13',
      munName: 'BITSMUN',
      adminEmails: ['finance@munhub.test'],
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['finance@munhub.test'])
    expect(result.subject.toLowerCase()).toContain('payment')
  })

  it('renders CRITICAL_VALIDATION_FAILURE including every blocker', () => {
    const event: PipelineEvent = {
      type: 'CRITICAL_VALIDATION_FAILURE',
      munId: 'mun-14',
      munName: 'HMUN',
      adminEmails: ['ops@munhub.test'],
      blockers: ['No committees defined', 'No registration products'],
    }
    const result = renderPipelineNotification(event)
    expect(result.body).toContain('No committees defined')
    expect(result.body).toContain('No registration products')
  })

  it('is a pure function — same event always renders identical content', () => {
    const event: PipelineEvent = {
      type: 'APPROVED',
      munId: 'mun-15',
      organizerEmail: 'org@test.dev',
      munName: 'Vista MUN',
    }
    expect(renderPipelineNotification(event)).toEqual(renderPipelineNotification(event))
  })
})

describe('notifyPipelineEvent', () => {
  it('calls adapter.send once per recipient with the rendered content', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const adapter: NotificationsAdapter = { send }

    await notifyPipelineEvent(
      {
        type: 'NEW_SUBMISSION',
        munId: 'mun-1',
        munName: 'Oxford MUN 2027',
        adminEmails: ['admin1@munhub.test', 'admin2@munhub.test'],
      },
      adapter,
    )

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin1@munhub.test', subject: expect.stringContaining('Oxford MUN 2027') }),
    )
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin2@munhub.test', subject: expect.stringContaining('Oxford MUN 2027') }),
    )
  })

  it('never throws when the adapter rejects — catches and logs instead', async () => {
    const send = vi.fn().mockRejectedValue(new Error('SMTP down'))
    const adapter: NotificationsAdapter = { send }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      notifyPipelineEvent(
        { type: 'APPROVED', munId: 'mun-1', organizerEmail: 'org@test.dev', munName: 'Oxford MUN 2027' },
        adapter,
      ),
    ).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('a failure for one recipient does not prevent delivery to the others', async () => {
    const send = vi.fn().mockImplementation(({ to }: { to: string }) => {
      if (to === 'admin1@munhub.test') {
        return Promise.reject(new Error('bounced'))
      }
      return Promise.resolve()
    })
    const adapter: NotificationsAdapter = { send }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await notifyPipelineEvent(
      {
        type: 'CRITICAL_VALIDATION_FAILURE',
        munId: 'mun-1',
        munName: 'Oxford MUN 2027',
        adminEmails: ['admin1@munhub.test', 'admin2@munhub.test'],
        blockers: ['x'],
      },
      adapter,
    )

    expect(send).toHaveBeenCalledTimes(2)
    errorSpy.mockRestore()
  })

  it('defaults to the console adapter when none is given', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await notifyPipelineEvent({
      type: 'APPROVED',
      munId: 'mun-1',
      organizerEmail: 'org@test.dev',
      munName: 'Oxford MUN 2027',
    })

    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })
})
