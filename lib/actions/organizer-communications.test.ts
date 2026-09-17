import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { db } from '@/lib/db/client'
import { registrationProducts, registrations, users, verificationLogs } from '@/lib/db/schema'
import type { NotificationPayload } from '@/lib/notifications/adapter'
import { consoleNotificationsAdapter } from '@/lib/notifications/console-adapter'
import {
  COMMUNICATION_SENT_ACTION,
  listMunCommunications,
  previewCommunicationAudience,
  renderDelegateMessage,
  sendMunCommunication,
  validateMessage,
} from './organizer-communications'
import { COMMUNICATION_LIMITS, ORGANIZER_OPS_ERRORS } from './organizer-ops-errors'
import { addDelegate, makeOpsFixture, makeUser, sessionFor, type OpsFixture } from './test-fixtures/organizer-ops'

// .env.test never sets ZEPTOMAIL_TOKEN, so getNotificationsAdapter() hands
// back the console adapter — spying on it captures every delivery.
let sendSpy: MockInstance<(notification: NotificationPayload) => Promise<void>>

beforeEach(() => {
  sendSpy = vi.spyOn(consoleNotificationsAdapter, 'send').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const message = { subject: 'Venue update', body: 'Day 1 moves to Hall B.\n\nBring your pass.' }

function sentTo(): string[] {
  return sendSpy.mock.calls.map(([notification]) => notification.to).sort()
}

async function auditRows(munId: string) {
  return db
    .select()
    .from(verificationLogs)
    .where(and(eq(verificationLogs.munId, munId), eq(verificationLogs.action, COMMUNICATION_SENT_ACTION)))
}

async function seedAudience(fixture: OpsFixture) {
  const confirmed = await addDelegate(fixture, { seated: true })
  const attended = await addDelegate(fixture, { status: 'ATTENDED' })
  const noShow = await addDelegate(fixture, { status: 'NO_SHOW' })
  await addDelegate(fixture, { status: 'CANCELLED' })
  await addDelegate(fixture, { status: 'PAYMENT_PENDING' })
  await addDelegate(fixture, { suspended: true })
  return { confirmed, attended, noShow }
}

describe('validateMessage', () => {
  it('trims and enforces the subject and body rules', () => {
    expect(validateMessage('  Hello  ', '\r\nBody\r\nline two  ')).toEqual({ subject: 'Hello', body: 'Body\nline two' })
    expect(() => validateMessage('  ', 'body')).toThrow('Subject is required')
    expect(() => validateMessage('a\nb', 'body')).toThrow(ORGANIZER_OPS_ERRORS.subjectMultiline)
    expect(() => validateMessage('x'.repeat(COMMUNICATION_LIMITS.subjectMaxLength + 1), 'body')).toThrow(
      ORGANIZER_OPS_ERRORS.subjectTooLong,
    )
    expect(() => validateMessage('Hi', ' ')).toThrow('Message is required')
    expect(() => validateMessage('Hi', 'x'.repeat(COMMUNICATION_LIMITS.bodyMaxLength + 1))).toThrow(
      ORGANIZER_OPS_ERRORS.bodyTooLong,
    )
  })
})

describe('renderDelegateMessage', () => {
  it('escapes everything the organizer typed in the HTML part', () => {
    const rendered = renderDelegateMessage({
      munName: 'Ops <MUN>',
      subject: '<img src=x onerror=alert(1)>',
      body: 'Hi "all" & <script>alert(1)</script>\nsecond line',
    })
    expect(rendered.subject).toBe('Ops <MUN>: <img src=x onerror=alert(1)>')
    expect(rendered.body).toContain('Hi "all" & <script>alert(1)</script>\nsecond line')
    expect(rendered.html).not.toContain('<script>')
    expect(rendered.html).not.toContain('<img')
    expect(rendered.html).toContain('Hi &quot;all&quot; &amp; &lt;script&gt;alert(1)&lt;/script&gt;<br>second line')
    expect(rendered.html).toContain('Ops &lt;MUN&gt;')
  })
})

describe('previewCommunicationAudience', () => {
  it('counts seat-holding, active delegates once each, with filters', async () => {
    const fixture = await makeOpsFixture()
    const { confirmed } = await seedAudience(fixture)
    // A second pass for the same delegate still counts them once.
    const [vipPass] = await db
      .insert(registrationProducts)
      .values({ munId: fixture.mun.id, name: 'Social Pass', price: 500, capacity: 50 })
      .returning()
    await db.insert(registrations).values({
      userId: confirmed.user.id,
      munId: fixture.mun.id,
      registrationProductId: vipPass.id,
      status: 'CONFIRMED',
    })

    const all = await previewCommunicationAudience(fixture.mun.id, {}, fixture.organizerSession)
    expect(all).toEqual({
      recipientCount: 3,
      maxRecipientsPerSend: COMMUNICATION_LIMITS.maxRecipientsPerSend,
      sendsRemainingThisHour: COMMUNICATION_LIMITS.maxSendsPerHour,
    })

    const preview = (audience: Parameters<typeof previewCommunicationAudience>[1]) =>
      previewCommunicationAudience(fixture.mun.id, audience, fixture.organizerSession).then((p) => p.recipientCount)
    expect(await preview({ statuses: ['CONFIRMED'] })).toBe(1)
    expect(await preview({ statuses: ['ATTENDED', 'NO_SHOW'] })).toBe(2)
    expect(await preview({ committeeId: fixture.committee.id })).toBe(1)
    expect(await preview({ registrationProductId: vipPass.id })).toBe(1)
    expect(await preview({ registrationProductId: fixture.pass.id })).toBe(3)
  })

  it('is owner-only', async () => {
    const fixture = await makeOpsFixture()
    const admin = await makeUser('ADMIN')
    const otherOrganizer = await makeUser('ORGANIZER')
    await expect(previewCommunicationAudience(fixture.mun.id, {}, sessionFor(admin))).rejects.toThrow('Forbidden')
    await expect(previewCommunicationAudience(fixture.mun.id, {}, sessionFor(otherOrganizer))).rejects.toThrow(
      'Forbidden',
    )
  })
})

describe('sendMunCommunication', () => {
  it('delivers once per matching delegate, records the send and lists it', async () => {
    const fixture = await makeOpsFixture()
    const { confirmed, attended, noShow } = await seedAudience(fixture)

    const result = await sendMunCommunication(
      fixture.mun.id,
      { ...message, audience: {} },
      fixture.organizerSession,
    )
    expect(result).toEqual({ recipientCount: 3, sent: 3, failed: 0 })
    expect(sentTo()).toEqual([confirmed.user.email, attended.user.email, noShow.user.email].sort())

    const [first] = sendSpy.mock.calls[0]
    expect(first.subject).toBe(`${fixture.mun.name}: Venue update`)
    expect(first.body).toContain('Day 1 moves to Hall B.')
    expect(first.html).toContain('Day 1 moves to Hall B.</p>')

    const rows = await auditRows(fixture.mun.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].reviewerId).toBe(fixture.organizer.id)
    expect(rows[0].notes).toBe('Delegate message "Venue update" to 3 recipients')

    const history = await listMunCommunications(fixture.mun.id, fixture.organizerSession)
    expect(history).toEqual([
      expect.objectContaining({ subject: 'Venue update', recipientCount: 3, sentBy: fixture.organizer.name }),
    ])
  })

  it('ignores the email preference for operational messages', async () => {
    const fixture = await makeOpsFixture()
    const { user } = await addDelegate(fixture)
    await db.update(users).set({ emailNotificationsEnabled: false }).where(eq(users.id, user.id))

    await sendMunCommunication(fixture.mun.id, { ...message, audience: {} }, fixture.organizerSession)
    expect(sentTo()).toEqual([user.email])
  })

  it('narrows to the chosen audience', async () => {
    const fixture = await makeOpsFixture()
    const { confirmed } = await seedAudience(fixture)
    const result = await sendMunCommunication(
      fixture.mun.id,
      { ...message, audience: { committeeId: fixture.committee.id, statuses: ['CONFIRMED'] } },
      fixture.organizerSession,
    )
    expect(result.recipientCount).toBe(1)
    expect(sentTo()).toEqual([confirmed.user.email])
  })

  it('counts a failed delivery without stopping the rest', async () => {
    const fixture = await makeOpsFixture()
    await addDelegate(fixture)
    await addDelegate(fixture)
    await addDelegate(fixture)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    sendSpy.mockRejectedValueOnce(new Error('provider down'))

    const result = await sendMunCommunication(fixture.mun.id, { ...message, audience: {} }, fixture.organizerSession)
    expect(result).toEqual({ recipientCount: 3, sent: 2, failed: 1 })
    expect(sendSpy).toHaveBeenCalledTimes(3)
  })

  it('refuses an empty audience and sends nothing', async () => {
    const fixture = await makeOpsFixture()
    await addDelegate(fixture, { status: 'CANCELLED' })
    await expect(
      sendMunCommunication(fixture.mun.id, { ...message, audience: {} }, fixture.organizerSession),
    ).rejects.toThrow(ORGANIZER_OPS_ERRORS.noRecipients)
    expect(sendSpy).not.toHaveBeenCalled()
    expect(await auditRows(fixture.mun.id)).toHaveLength(0)
  })

  it('refuses an audience over the per-message cap', async () => {
    const fixture = await makeOpsFixture()
    const count = COMMUNICATION_LIMITS.maxRecipientsPerSend + 1
    const suffix = crypto.randomUUID()
    const delegates = await db
      .insert(users)
      .values(
        Array.from({ length: count }, (_, index) => ({
          name: `Bulk ${index}`,
          email: `bulk-${index}-${suffix}@test.dev`,
          role: 'STUDENT' as const,
        })),
      )
      .returning({ id: users.id })
    await db.insert(registrations).values(
      delegates.map((delegate) => ({
        userId: delegate.id,
        munId: fixture.mun.id,
        registrationProductId: fixture.pass.id,
        status: 'CONFIRMED' as const,
      })),
    )

    expect((await previewCommunicationAudience(fixture.mun.id, {}, fixture.organizerSession)).recipientCount).toBe(
      count,
    )
    await expect(
      sendMunCommunication(fixture.mun.id, { ...message, audience: {} }, fixture.organizerSession),
    ).rejects.toThrow(ORGANIZER_OPS_ERRORS.audienceTooLarge)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('enforces the hourly per-MUN limit, including for concurrent sends', async () => {
    const fixture = await makeOpsFixture()
    await addDelegate(fixture)
    const attempts = COMMUNICATION_LIMITS.maxSendsPerHour + 2

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        sendMunCommunication(fixture.mun.id, { ...message, audience: {} }, fixture.organizerSession),
      ),
    )
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(COMMUNICATION_LIMITS.maxSendsPerHour)
    expect(rejected).toHaveLength(2)
    for (const result of rejected) {
      expect((result as PromiseRejectedResult).reason.message).toBe(ORGANIZER_OPS_ERRORS.hourlySendLimit)
    }
    expect(await auditRows(fixture.mun.id)).toHaveLength(COMMUNICATION_LIMITS.maxSendsPerHour)
    const preview = await previewCommunicationAudience(fixture.mun.id, {}, fixture.organizerSession)
    expect(preview.sendsRemainingThisHour).toBe(0)
  })

  it('validates before touching the database and is owner-only', async () => {
    const fixture = await makeOpsFixture()
    await addDelegate(fixture)
    const admin = await makeUser('ADMIN')

    await expect(
      sendMunCommunication(fixture.mun.id, { subject: '', body: 'x', audience: {} }, fixture.organizerSession),
    ).rejects.toThrow('Subject is required')
    await expect(
      sendMunCommunication(fixture.mun.id, { ...message, audience: {} }, sessionFor(admin)),
    ).rejects.toThrow('Forbidden')
    expect(sendSpy).not.toHaveBeenCalled()
  })
})
