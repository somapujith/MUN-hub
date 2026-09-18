import { describe, expect, it, vi } from 'vitest'
import { notifyPipelineEvent, renderPipelineNotification, type PipelineEvent } from './pipeline-events'
import type { NotificationsAdapter } from './adapter'

describe('renderPipelineNotification', () => {
  it('renders MODULE_ACTION_REQUIRED with branded HTML including module name and each issue', () => {
    const event: PipelineEvent = {
      type: 'MODULE_ACTION_REQUIRED',
      munId: 'mun-2',
      organizerEmail: 'org@test.dev',
      munName: 'VIT MUN',
      moduleName: 'Executive Board',
      issues: ['Chair missing', 'Vice-chair missing'],
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['org@test.dev'])
    expect(result.subject).toContain('Executive Board')
    expect(result.body).toContain('Chair missing')
    expect(result.body).toContain('Vice-chair missing')
    expect(result.html).toBeTruthy()
    expect(result.html).toContain('Executive Board')
    expect(result.html).toContain('Chair missing')
  })

  it('renders CHANGES_REQUESTED with branded HTML including the reason', () => {
    const event: PipelineEvent = {
      type: 'CHANGES_REQUESTED',
      munId: 'mun-6',
      organizerEmail: 'org@test.dev',
      munName: 'Vista MUN',
      moduleName: 'FINAL_REVIEW',
      reason: 'Capacity exceeds venue limit',
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['org@test.dev'])
    expect(result.subject).toContain('Vista MUN')
    expect(result.body).toContain('Capacity exceeds venue limit')
    expect(result.html).toBeTruthy()
    expect(result.html).toContain('Capacity exceeds venue limit')
  })

  it('renders APPROVED with branded HTML', () => {
    const event: PipelineEvent = {
      type: 'APPROVED',
      munId: 'mun-7',
      organizerEmail: 'org@test.dev',
      munName: 'St. Francis MUN',
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['org@test.dev'])
    expect(result.subject).toContain('approved')
    expect(result.subject).toContain('St. Francis MUN')
    expect(result.body).toContain('St. Francis MUN')
    expect(result.html).toBeTruthy()
    expect(result.html).toContain('St. Francis MUN')
  })

  it('renders PUBLISHED with branded HTML including the public URL', () => {
    const event: PipelineEvent = {
      type: 'PUBLISHED',
      munId: 'mun-9',
      organizerEmail: 'org@test.dev',
      munName: 'Oxford MUN 2027',
      publicUrl: 'https://munhub.in/mun/oxford-mun-2027',
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['org@test.dev'])
    expect(result.body).toContain('https://munhub.in/mun/oxford-mun-2027')
    expect(result.subject.toLowerCase()).toContain('live')
    expect(result.html).toBeTruthy()
    expect(result.html).toContain('https://munhub.in/mun/oxford-mun-2027')
  })

  it('renders NEW_SUBMISSION to all admin emails, plain text only', () => {
    const event: PipelineEvent = {
      type: 'NEW_SUBMISSION',
      munId: 'mun-11',
      munName: 'Oxford MUN 2027',
      adminEmails: ['admin1@munhub.test', 'admin2@munhub.test'],
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['admin1@munhub.test', 'admin2@munhub.test'])
    expect(result.subject).toContain('Oxford MUN 2027')
    expect(result.html).toBeUndefined()
  })

  it('renders RESUBMISSION to all admin emails, plain text only', () => {
    const event: PipelineEvent = {
      type: 'RESUBMISSION',
      munId: 'mun-12',
      munName: 'CBITMUN',
      adminEmails: ['admin1@munhub.test'],
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['admin1@munhub.test'])
    expect(result.subject.toLowerCase()).toContain('resubmission')
    expect(result.html).toBeUndefined()
  })

  it('renders PAYMENT_VERIFICATION_ISSUE to all admin emails, plain text only', () => {
    const event: PipelineEvent = {
      type: 'PAYMENT_VERIFICATION_ISSUE',
      munId: 'mun-13',
      munName: 'BITSMUN',
      adminEmails: ['finance@munhub.test'],
    }
    const result = renderPipelineNotification(event)
    expect(result.to).toEqual(['finance@munhub.test'])
    expect(result.subject.toLowerCase()).toContain('payment')
    expect(result.html).toBeUndefined()
  })

  it('renders CRITICAL_VALIDATION_FAILURE including every blocker, plain text only', () => {
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
    expect(result.html).toBeUndefined()
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

  it('passes the rendered html through to the adapter for a templated event', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const adapter: NotificationsAdapter = { send }

    await notifyPipelineEvent(
      { type: 'APPROVED', munId: 'mun-1', organizerEmail: 'org@test.dev', munName: 'Oxford MUN 2027' },
      adapter,
    )

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'org@test.dev', html: expect.stringContaining('Oxford MUN 2027') }),
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
