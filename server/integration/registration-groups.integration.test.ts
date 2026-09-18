import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { completeStudentProfile } from '@/lib/actions/student-profile'
import { db } from '@/lib/db/client'
import { muns, registrationGroups, registrationProducts, registrations } from '@/lib/db/schema'
import { consoleNotificationsAdapter } from '@/lib/notifications/console-adapter'
import type { NotificationPayload } from '@/lib/notifications/adapter'
import { createApp } from '../src/app'
import { authHeaders, makeUser } from './helpers'

const app = createApp()

async function makeMun(overrides: Partial<(typeof registrationProducts.$inferInsert)> = {}) {
  const organizer = await makeUser('ORGANIZER')
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Group Mun', slug: `grp-int-${crypto.randomUUID()}`, status: 'REGISTRATION_OPEN' })
    .returning()
  const [pass] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegation', price: 1000, capacity: 20, allowsDelegation: true, ...overrides })
    .returning()
  return { mun, pass }
}

async function makeStudent() {
  const student = await makeUser('STUDENT')
  await completeStudentProfile(
    {
      phone: '9876501234',
      institution: 'Test College',
      dateOfBirth: '2004-06-15',
      gradeOrYear: '3rd year',
      residentialAddress: '1 Test Lane',
      requiresTransportation: false,
      emergencyContactName: 'Guardian',
      emergencyContactPhone: '9876505678',
      emergencyContactRelation: 'Parent',
    },
    { userId: student.id, role: 'STUDENT' },
  )
  return { id: student.id, headers: await authHeaders(student.id) }
}

function startGroup(headers: Record<string, string>, body: Record<string, unknown>) {
  return app.request('/api/v1/registrations/group', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  })
}

/** Starts and pays for a `teamSize`-person group over HTTP, returning its id and head registration id. */
async function startAndPayGroup(teamSize: number, mun: { id: string }, pass: { id: string }) {
  const head = await makeStudent()
  const res = await startGroup(head.headers, { munId: mun.id, registrationProductId: pass.id, teamSize })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { groupId: string; headRegistrationId: string }
  // Pay directly against the DB rather than round-tripping the mock-payment
  // endpoint — this suite is about group management authz, not checkout.
  await db.update(registrations).set({ status: 'CONFIRMED' }).where(eq(registrations.registrationGroupId, body.groupId))
  return { head, groupId: body.groupId, headRegistrationId: body.headRegistrationId }
}

describe('POST /registrations/group', () => {
  it('requires a complete profile, same as solo registration', async () => {
    const { mun, pass } = await makeMun()
    const student = await makeUser('STUDENT')
    const res = await startGroup(await authHeaders(student.id), { munId: mun.id, registrationProductId: pass.id, teamSize: 3 })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT_STATE')
  })

  it('rejects a pass without allowsDelegation with 409', async () => {
    const { mun, pass } = await makeMun({ allowsDelegation: false })
    const res = await startGroup((await makeStudent()).headers, { munId: mun.id, registrationProductId: pass.id, teamSize: 2 })
    expect(res.status).toBe(409)
  })

  it('reserves teamSize seats and one order for the full amount on a valid request', async () => {
    const { mun, pass } = await makeMun()
    const res = await startGroup((await makeStudent()).headers, { munId: mun.id, registrationProductId: pass.id, teamSize: 4 })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.orderId).toMatch(/^mock_order_/)

    const [group] = await db.select().from(registrationGroups).where(eq(registrationGroups.id, body.groupId))
    expect(group.teamSize).toBe(4)
    const rows = await db.select().from(registrations).where(eq(registrations.registrationGroupId, body.groupId))
    expect(rows).toHaveLength(4)
  })
})

describe('registration-groups authz', () => {
  it('the head can view the roster; a stranger gets 403; staff can too', async () => {
    const { mun, pass } = await makeMun()
    const { head, groupId } = await startAndPayGroup(2, mun, pass)
    const stranger = await makeStudent()
    const admin = await makeUser('ADMIN')

    const asHead = await app.request(`/api/v1/registration-groups/${groupId}`, { headers: head.headers })
    expect(asHead.status).toBe(200)

    const asStranger = await app.request(`/api/v1/registration-groups/${groupId}`, { headers: stranger.headers })
    expect(asStranger.status).toBe(403)

    const asAdmin = await app.request(`/api/v1/registration-groups/${groupId}`, { headers: await authHeaders(admin.id) })
    expect(asAdmin.status).toBe(200)

    const signedOut = await app.request(`/api/v1/registration-groups/${groupId}`)
    expect(signedOut.status).toBe(401)
  })

  it('only the head can invite, resend, or cancel — a stranger gets 403', async () => {
    const { mun, pass } = await makeMun()
    const { head, groupId } = await startAndPayGroup(2, mun, pass)
    const stranger = await makeStudent()

    const strangerInvite = await app.request(`/api/v1/registration-groups/${groupId}/invitations`, {
      method: 'POST',
      headers: { ...stranger.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nope@test.dev' }),
    })
    expect(strangerInvite.status).toBe(403)

    const headInvite = await app.request(`/api/v1/registration-groups/${groupId}/invitations`, {
      method: 'POST',
      headers: { ...head.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'friend@test.dev', invitedName: 'Friend' }),
    })
    expect(headInvite.status).toBe(201)
    const invitation = await headInvite.json()

    const strangerCancel = await app.request(`/api/v1/registration-groups/invitations/${invitation.id}/cancel`, {
      method: 'POST',
      headers: stranger.headers,
    })
    expect(strangerCancel.status).toBe(403)

    const strangerResend = await app.request(`/api/v1/registration-groups/invitations/${invitation.id}/resend`, {
      method: 'POST',
      headers: stranger.headers,
    })
    expect(strangerResend.status).toBe(403)

    const headCancel = await app.request(`/api/v1/registration-groups/invitations/${invitation.id}/cancel`, {
      method: 'POST',
      headers: head.headers,
    })
    expect(headCancel.status).toBe(204)
  })

  it("refuses an invite before the group's own registration is paid", async () => {
    const { mun, pass } = await makeMun()
    const head = await makeStudent()
    const start = await startGroup(head.headers, { munId: mun.id, registrationProductId: pass.id, teamSize: 2 })
    const { groupId } = await start.json()

    const res = await app.request(`/api/v1/registration-groups/${groupId}/invitations`, {
      method: 'POST',
      headers: { ...head.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'friend@test.dev' }),
    })
    expect(res.status).toBe(409)
  })
})

describe('POST /registration-groups/:id/registrations/:registrationId/release', () => {
  it('is head-only, and frees a claimed-but-unpaid seat for a fresh invite once paid', async () => {
    const { mun, pass } = await makeMun()
    const head = await makeStudent()
    const start = await startGroup(head.headers, { munId: mun.id, registrationProductId: pass.id, teamSize: 2 })
    const { groupId, headRegistrationId } = await start.json()
    const rows = await db.select().from(registrations).where(eq(registrations.registrationGroupId, groupId))
    const placeholder = rows.find((r) => r.id !== headRegistrationId)!

    // Simulate a teammate having claimed the seat while still unpaid — see
    // lib/actions/registration-group.test.ts for why this can't happen via
    // the real invite/accept flow (invites require the team to be paid) and
    // why the guard must still be correct against the row state either way.
    const wrongPerson = await makeUser('STUDENT')
    await db.update(registrations).set({ userId: wrongPerson.id }).where(eq(registrations.id, placeholder.id))

    const stranger = await makeStudent()
    const strangerAttempt = await app.request(
      `/api/v1/registration-groups/${groupId}/registrations/${placeholder.id}/release`,
      { method: 'POST', headers: stranger.headers },
    )
    expect(strangerAttempt.status).toBe(403)

    const released = await app.request(
      `/api/v1/registration-groups/${groupId}/registrations/${placeholder.id}/release`,
      { method: 'POST', headers: head.headers },
    )
    expect(released.status).toBe(204)
    const [row] = await db.select().from(registrations).where(eq(registrations.id, placeholder.id))
    expect(row.userId).toBe(head.id)

    // Now pay, and confirm the release actually reopened the seat.
    await db.update(registrations).set({ status: 'CONFIRMED' }).where(eq(registrations.registrationGroupId, groupId))
    const invite = await app.request(`/api/v1/registration-groups/${groupId}/invitations`, {
      method: 'POST',
      headers: { ...head.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'replacement@test.dev' }),
    })
    expect(invite.status).toBe(201)
  })

  it('refuses once the seat has actually been claimed on a paid team', async () => {
    const { mun, pass } = await makeMun()
    const { head, groupId } = await startAndPayGroup(2, mun, pass)

    let delivered: NotificationPayload | undefined
    vi.spyOn(consoleNotificationsAdapter, 'send').mockImplementation(async (notification) => {
      delivered = notification
    })
    const invite = await app.request(`/api/v1/registration-groups/${groupId}/invitations`, {
      method: 'POST',
      headers: { ...head.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'friend@test.dev' }),
    })
    expect(invite.status).toBe(201)
    const token = extractToken(delivered)

    const invitee = await makeStudent()
    const accept = await app.request(`/api/v1/group-invitations/${token}/accept`, {
      method: 'POST',
      headers: { ...invitee.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ formResponses: { fullName: 'Friend' } }),
    })
    expect(accept.status).toBe(200)
    const { registrationId } = await accept.json()

    const paidRelease = await app.request(
      `/api/v1/registration-groups/${groupId}/registrations/${registrationId}/release`,
      { method: 'POST', headers: head.headers },
    )
    expect(paidRelease.status).toBe(409)
    expect((await paidRelease.json()).error.code).toBe('CONFLICT_STATE')

    const [row] = await db.select().from(registrations).where(eq(registrations.id, registrationId))
    expect(row.userId).toBe(invitee.id) // untouched
  })
})

function extractToken(notification: NotificationPayload | undefined): string {
  const match = notification?.body.match(/token=([a-f0-9]+)/)
  if (!match) throw new Error(`No invite token found in notification body: ${notification?.body}`)
  return match[1]
}

describe('group invitation accept flow', () => {
  it('is publicly previewable, requires sign-in to accept, and a stranger cannot reuse an already-accepted token', async () => {
    const { mun, pass } = await makeMun()
    const { head, groupId } = await startAndPayGroup(2, mun, pass)

    let delivered: NotificationPayload | undefined
    vi.spyOn(consoleNotificationsAdapter, 'send').mockImplementation(async (notification) => {
      delivered = notification
    })

    const inviteRes = await app.request(`/api/v1/registration-groups/${groupId}/invitations`, {
      method: 'POST',
      headers: { ...head.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'friend@test.dev' }),
    })
    expect(inviteRes.status).toBe(201)
    const token = extractToken(delivered)

    // Preview is public — no auth header at all — and reports who invited whom.
    const preview = await app.request(`/api/v1/group-invitations/${token}`)
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({ status: 'PENDING', munName: mun.name, invitedEmail: 'friend@test.dev' })

    const previewOfBogusToken = await app.request(`/api/v1/group-invitations/not-a-real-token`)
    expect(previewOfBogusToken.status).toBe(400)

    // Accept requires auth.
    const unauthAccept = await app.request(`/api/v1/group-invitations/${token}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(unauthAccept.status).toBe(401)

    // The invited person accepts, claiming the open slot.
    const invitee = await makeStudent()
    const acceptRes = await app.request(`/api/v1/group-invitations/${token}/accept`, {
      method: 'POST',
      headers: { ...invitee.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ formResponses: { fullName: 'Friend', email: 'friend@test.dev' } }),
    })
    expect(acceptRes.status).toBe(200)
    const accepted = await acceptRes.json()
    const [claimedRow] = await db.select().from(registrations).where(eq(registrations.id, accepted.registrationId))
    expect(claimedRow.userId).toBe(invitee.id)

    // A different stranger reusing the same, now-consumed token gets the
    // same generic "invalid or expired" answer — never a confusing
    // already-claimed error that would confirm the token was ever valid.
    const stranger = await makeStudent()
    const strangerReuse = await app.request(`/api/v1/group-invitations/${token}/accept`, {
      method: 'POST',
      headers: { ...stranger.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(strangerReuse.status).toBe(400)
  })
})
