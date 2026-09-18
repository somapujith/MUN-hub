import { and, eq, inArray, ne } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db/client'
import {
  muns,
  registrationGroupInvitations,
  registrationGroups,
  registrationProducts,
  registrations,
  users,
} from '@/lib/db/schema'
import type { Session } from '@/lib/auth/adapter'
import type { NotificationsAdapter } from '@/lib/notifications/adapter'
import {
  GROUP_MAX_SIZE,
  GROUP_MIN_SIZE,
  REGISTRATION_ERRORS,
  initiateGroupRegistration,
  initiateRegistration,
} from './registration'
import {
  GROUP_ERRORS,
  acceptGroupInvitation,
  cancelGroupInvitation,
  getGroupRoster,
  getInvitationPreview,
  inviteGroupMember,
  releaseGroupSeat,
  resendGroupInvitation,
} from './registration-group'

const APP_URL = 'https://app.test'

function mockAdapter(): NotificationsAdapter & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async () => {}) }
}

async function createUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({ name: 'Test User', email: `user-${crypto.randomUUID()}@test.dev`, role: 'STUDENT', ...overrides })
    .returning()
  return user
}

function sessionFor(userId: string, role: Session['role'] = 'STUDENT'): Session {
  return { userId, role }
}

async function setup(options: { capacity?: number; price?: number; allowsDelegation?: boolean } = {}) {
  const organizer = await createUser({ role: 'ORGANIZER' })
  const head = await createUser()
  const [mun] = await db
    .insert(muns)
    .values({ organizerId: organizer.id, name: 'Group Mun', slug: `group-mun-${crypto.randomUUID()}`, status: 'REGISTRATION_OPEN' })
    .returning()
  const [product] = await db
    .insert(registrationProducts)
    .values({
      munId: mun.id,
      name: 'Delegation Pass',
      price: options.price ?? 1000,
      capacity: options.capacity ?? 10,
      allowsDelegation: options.allowsDelegation ?? true,
    })
    .returning()
  return { organizer, head, mun, product, session: sessionFor(head.id) }
}

/** Starts and pays for a `teamSize`-person group, returning the roster's live groupId. */
async function startAndPayGroup(teamSize: number, options: { capacity?: number; price?: number } = {}) {
  const { head, mun, product, session } = await setup(options)
  const start = await initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize }, session)
  if (start.orderId) {
    await db
      .update(registrations)
      .set({ status: 'CONFIRMED' })
      .where(eq(registrations.registrationGroupId, start.groupId))
  }
  return { head, mun, product, session, groupId: start.groupId, headRegistrationId: start.headRegistrationId }
}

describe('initiateGroupRegistration', () => {
  it('reserves teamSize seats: one head registration plus teamSize-1 unclaimed placeholders, and one order for the full amount', async () => {
    const { mun, product, session, head } = await setup({ price: 500 })

    const result = await initiateGroupRegistration(
      { munId: mun.id, registrationProductId: product.id, teamSize: 4 },
      session,
    )

    expect(result.orderId).toMatch(/^mock_order_/)
    expect(result.status).toBe('PAYMENT_PENDING')

    const rows = await db.select().from(registrations).where(eq(registrations.registrationGroupId, result.groupId))
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.status === 'PAYMENT_PENDING')).toBe(true)
    expect(rows.every((r) => r.userId === head.id)).toBe(true) // 3 placeholders still "owned" by the head
    expect(rows.find((r) => r.id === result.headRegistrationId)).toBeTruthy()

    const [group] = await db.select().from(registrationGroups).where(eq(registrationGroups.id, result.groupId))
    expect(group.headRegistrationId).toBe(result.headRegistrationId)
    expect(group.teamSize).toBe(4)

    const [payment] = await db.query.payments.findMany({ where: (p, { eq: eqOp }) => eqOp(p.registrationId, result.headRegistrationId) })
    expect(payment.amount).toBe(500 * 4)
  })

  it('confirms every seat immediately for a free pass, with no payment order', async () => {
    const { mun, product, session } = await setup({ price: 0 })
    const result = await initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize: 3 }, session)

    expect(result.orderId).toBeNull()
    expect(result.status).toBe('CONFIRMED')
    const rows = await db.select().from(registrations).where(eq(registrations.registrationGroupId, result.groupId))
    expect(rows.every((r) => r.status === 'CONFIRMED')).toBe(true)
  })

  it('rejects a pass that does not allow delegation', async () => {
    const { mun, product, session } = await setup({ allowsDelegation: false })
    await expect(
      initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize: 2 }, session),
    ).rejects.toThrow(REGISTRATION_ERRORS.delegationNotAllowed)
  })

  it.each([GROUP_MIN_SIZE - 1, GROUP_MAX_SIZE + 1, 2.5])('rejects an invalid team size (%s)', async (teamSize) => {
    const { mun, product, session } = await setup()
    await expect(
      initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize }, session),
    ).rejects.toThrow(REGISTRATION_ERRORS.groupSizeInvalid)
  })

  it('rejects when fewer than teamSize seats remain', async () => {
    const { mun, product, session } = await setup({ capacity: 3 })
    await expect(
      initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize: 4 }, session),
    ).rejects.toThrow('Registration product is at capacity')
  })

  it('rejects a head who already has an active registration for this product', async () => {
    const { mun, product, session } = await setup()
    await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, session)
    await expect(
      initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize: 2 }, session),
    ).rejects.toThrow('You already have an active registration for this product')
  })

  it('replays the same group for a repeated idempotency key instead of reserving twice', async () => {
    const { mun, product, session } = await setup()
    const idempotencyKey = crypto.randomUUID()
    const input = { munId: mun.id, registrationProductId: product.id, teamSize: 3 }

    const first = await initiateGroupRegistration(input, session, { idempotencyKey })
    const second = await initiateGroupRegistration(input, session, { idempotencyKey })

    expect(second).toEqual({ ...first, replayed: true })
    expect(await db.select().from(registrationGroups).where(eq(registrationGroups.headUserId, session.userId))).toHaveLength(1)
  })

  it('never oversells capacity when a group registration races solo registrations for the last few seats', async () => {
    // Capacity 5: one 3-person group plus five concurrent solo callers
    // competing for the remaining 2 seats — total confirmed seats must never
    // exceed 5, and the product-row lock must serialize the group's N-seat
    // reservation the same way it serializes a solo 1-seat one.
    const { mun, product } = await setup({ capacity: 5 })
    const groupHead = await createUser()
    const soloStudents = await Promise.all(Array.from({ length: 5 }, () => createUser()))

    const results = await Promise.allSettled([
      initiateGroupRegistration(
        { munId: mun.id, registrationProductId: product.id, teamSize: 3 },
        sessionFor(groupHead.id),
      ),
      ...soloStudents.map((student) =>
        initiateRegistration({ munId: mun.id, registrationProductId: product.id }, sessionFor(student.id)),
      ),
    ])

    const activeRows = await db
      .select()
      .from(registrations)
      .where(
        and(
          eq(registrations.registrationProductId, product.id),
          inArray(registrations.status, ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED']),
        ),
      )
    expect(activeRows.length).toBeLessThanOrEqual(5)

    // At least the group's own capacity check must have been enforced
    // correctly: either it won all 3 seats and at most 2 solo callers also
    // won, or it lost entirely — never a partial group reservation.
    const groupRows = activeRows.filter((r) => r.userId === groupHead.id)
    expect([0, 3]).toContain(groupRows.length)
    void results
  })
})

describe('registration-group: roster, invite, resend, cancel, accept', () => {
  it('getGroupRoster shows the head, unclaimed slots, and rejects a non-head, non-staff caller', async () => {
    const { groupId, headRegistrationId, head } = await startAndPayGroup(3)

    const roster = await getGroupRoster(groupId, sessionFor(head.id))
    expect(roster.teamSize).toBe(3)
    expect(roster.status).toBe('CONFIRMED')
    expect(roster.slots).toHaveLength(3)
    const headSlot = roster.slots.find((s) => s.registrationId === headRegistrationId)
    expect(headSlot).toMatchObject({ isHead: true, member: { name: head.name } })
    expect(roster.slots.filter((s) => !s.member)).toHaveLength(2)

    const stranger = await createUser()
    await expect(getGroupRoster(groupId, sessionFor(stranger.id))).rejects.toThrow('Forbidden')

    const admin = await createUser({ role: 'ADMIN' })
    await expect(getGroupRoster(groupId, sessionFor(admin.id, 'ADMIN'))).resolves.toBeTruthy()
  })

  it('inviteGroupMember fills an open slot, is head-only, and refuses before the group is paid', async () => {
    const { mun, product, session } = await setup()
    const start = await initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize: 2 }, session)

    // Still PAYMENT_PENDING — not paid yet.
    const adapter = mockAdapter()
    await expect(inviteGroupMember(start.groupId, 'friend@test.dev', undefined, APP_URL, session, adapter)).rejects.toThrow(
      GROUP_ERRORS.notPaid,
    )

    await db.update(registrations).set({ status: 'CONFIRMED' }).where(eq(registrations.registrationGroupId, start.groupId))

    const stranger = await createUser()
    await expect(
      inviteGroupMember(start.groupId, 'friend@test.dev', undefined, APP_URL, sessionFor(stranger.id), adapter),
    ).rejects.toThrow('Forbidden')

    const invitation = await inviteGroupMember(start.groupId, 'Friend@Test.DEV ', 'Friend', APP_URL, session, adapter)
    expect(invitation.email).toBe('friend@test.dev')
    expect(adapter.send).toHaveBeenCalledTimes(1)
    expect(adapter.send.mock.calls[0][0]).toMatchObject({ to: 'friend@test.dev' })

    const roster = await getGroupRoster(start.groupId, session)
    const invitedSlot = roster.slots.find((s) => s.invitation?.id === invitation.id)
    expect(invitedSlot?.invitation).toMatchObject({ status: 'PENDING', email: 'friend@test.dev' })
  })

  it('inviteGroupMember refuses once every seat already has a pending invitation', async () => {
    const { groupId, session } = await startAndPayGroup(2) // 1 open teammate seat
    const adapter = mockAdapter()

    await inviteGroupMember(groupId, 'first@test.dev', undefined, APP_URL, session, adapter)
    await expect(inviteGroupMember(groupId, 'second@test.dev', undefined, APP_URL, session, adapter)).rejects.toThrow(
      GROUP_ERRORS.full,
    )
  })

  it('cancelGroupInvitation frees the slot for a fresh invite to a different address', async () => {
    const { groupId, session } = await startAndPayGroup(2)
    const adapter = mockAdapter()

    const first = await inviteGroupMember(groupId, 'first@test.dev', undefined, APP_URL, session, adapter)
    await cancelGroupInvitation(first.id, session)

    const second = await inviteGroupMember(groupId, 'second@test.dev', undefined, APP_URL, session, adapter)
    expect(second.email).toBe('second@test.dev')

    // The roster only ever shows the latest invitation per slot (by design —
    // see getGroupRoster's header comment) — a 2-person group has exactly
    // one non-head slot, so the second invite necessarily reuses it and the
    // cancelled first invitation's history lives only in the table itself.
    const [cancelledRow] = await db
      .select()
      .from(registrationGroupInvitations)
      .where(eq(registrationGroupInvitations.id, first.id))
    expect(cancelledRow.status).toBe('CANCELLED')

    const roster = await getGroupRoster(groupId, session)
    const openSlot = roster.slots.find((s) => s.invitation?.id === second.id)
    expect(openSlot?.invitation).toMatchObject({ status: 'PENDING', email: 'second@test.dev' })
  })

  it('resendGroupInvitation rotates the token and enforces a cooldown', async () => {
    const { groupId, session } = await startAndPayGroup(2)
    const adapter = mockAdapter()
    const invitation = await inviteGroupMember(groupId, 'friend@test.dev', undefined, APP_URL, session, adapter)

    await expect(resendGroupInvitation(invitation.id, APP_URL, session, adapter)).rejects.toThrow(GROUP_ERRORS.resendCooldown)

    // Simulate the cooldown having elapsed.
    await db
      .update(registrationGroupInvitations)
      .set({ lastSentAt: new Date(Date.now() - 61_000) })
      .where(eq(registrationGroupInvitations.id, invitation.id))

    const resent = await resendGroupInvitation(invitation.id, APP_URL, session, adapter)
    expect(resent.email).toBe('friend@test.dev')
    expect(adapter.send).toHaveBeenCalledTimes(2)
  })

  it('acceptGroupInvitation claims the slot for the invited user and fills in their answers', async () => {
    const { groupId, session } = await startAndPayGroup(2)
    const adapter = mockAdapter()
    const friendEmail = `friend-${crypto.randomUUID()}@test.dev`
    await inviteGroupMember(groupId, friendEmail, 'Friend', APP_URL, session, adapter)
    const rawToken = new URL(adapter.send.mock.calls[0][0].body.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!

    const invitee = await createUser({ email: friendEmail })
    const accepted = await acceptGroupInvitation(rawToken, { fullName: 'Friend', email: friendEmail }, sessionFor(invitee.id))
    expect(accepted.registrationId).toBeTruthy()

    const [claimed] = await db.select().from(registrations).where(eq(registrations.id, accepted.registrationId))
    expect(claimed.userId).toBe(invitee.id)
    expect(claimed.formResponses).toMatchObject({ fullName: 'Friend' })

    const roster = await getGroupRoster(groupId, session)
    const claimedSlot = roster.slots.find((s) => s.registrationId === accepted.registrationId)
    expect(claimedSlot?.member).toMatchObject({ name: invitee.name })
    expect(claimedSlot?.isHead).toBe(false)
  })

  it('rejects the head accepting their own invitation, a double-join, and a token reused by someone else', async () => {
    const { groupId, session, head } = await startAndPayGroup(3)
    const adapter = mockAdapter()
    await inviteGroupMember(groupId, 'friend1@test.dev', undefined, APP_URL, session, adapter)
    const token1 = new URL(adapter.send.mock.calls[0][0].body.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!

    // The head can't accept their own team's invitation.
    await expect(acceptGroupInvitation(token1, undefined, session)).rejects.toThrow(GROUP_ERRORS.isHead)

    const invitee = await createUser()
    await acceptGroupInvitation(token1, { fullName: invitee.name, email: invitee.email }, sessionFor(invitee.id))

    // The same person can't join their own team's second open seat too.
    await inviteGroupMember(groupId, 'friend2@test.dev', undefined, APP_URL, session, adapter)
    const token2 = new URL(adapter.send.mock.calls[1][0].body.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!
    await expect(acceptGroupInvitation(token2, undefined, sessionFor(invitee.id))).rejects.toThrow(GROUP_ERRORS.alreadyMember)

    // A stranger using the same (now-consumed) first token gets the same
    // generic "invalid or expired" answer, not a confusing state error.
    const stranger = await createUser()
    await expect(acceptGroupInvitation(token1, undefined, sessionFor(stranger.id))).rejects.toThrow(GROUP_ERRORS.invalidInvite)
  })

  it('rejects an invitee who already has an active registration for the same product outside the group', async () => {
    const { mun, product, groupId, session } = await startAndPayGroup(2)
    const adapter = mockAdapter()
    await inviteGroupMember(groupId, 'friend@test.dev', undefined, APP_URL, session, adapter)
    const token = new URL(adapter.send.mock.calls[0][0].body.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!

    const invitee = await createUser()
    await initiateRegistration({ munId: mun.id, registrationProductId: product.id }, sessionFor(invitee.id))

    await expect(acceptGroupInvitation(token, undefined, sessionFor(invitee.id))).rejects.toThrow(
      'You already have an active registration for this product',
    )
  })

  it('expires a stale invitation and getInvitationPreview reports it as EXPIRED', async () => {
    const { groupId, session } = await startAndPayGroup(2)
    const adapter = mockAdapter()
    const invitation = await inviteGroupMember(groupId, 'friend@test.dev', undefined, APP_URL, session, adapter)
    const rawToken = new URL(adapter.send.mock.calls[0][0].body.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!

    await db
      .update(registrationGroupInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(registrationGroupInvitations.id, invitation.id))

    const preview = await getInvitationPreview(rawToken)
    expect(preview.status).toBe('EXPIRED')

    const stranger = await createUser()
    await expect(acceptGroupInvitation(rawToken, undefined, sessionFor(stranger.id))).rejects.toThrow(GROUP_ERRORS.invalidInvite)
  })

  it('getInvitationPreview throws for an unknown token', async () => {
    await expect(getInvitationPreview('not-a-real-token')).rejects.toThrow(GROUP_ERRORS.invalidInvite)
  })
})

describe('releaseGroupSeat', () => {
  /** Simulates a teammate having claimed `registrationId` while the group is still in a pre-payment hold — not reachable via the real accept flow (acceptGroupInvitation requires CONFIRMED), but the guard must be correct against the row state regardless of how it arose. */
  async function claimSlotDirectly(registrationId: string, claimedBy: { id: string }) {
    await db
      .update(registrations)
      .set({ userId: claimedBy.id, formResponses: { fullName: claimedBy.id } })
      .where(eq(registrations.id, registrationId))
  }

  it('is head-only: a stranger gets Forbidden, staff can act too', async () => {
    const { mun, product, session } = await setup()
    const start = await initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize: 2 }, session)
    const [placeholder] = await db
      .select()
      .from(registrations)
      .where(and(eq(registrations.registrationGroupId, start.groupId), ne(registrations.id, start.headRegistrationId)))
    const teammate = await createUser()
    await claimSlotDirectly(placeholder.id, teammate)

    const stranger = await createUser()
    await expect(releaseGroupSeat(start.groupId, placeholder.id, sessionFor(stranger.id))).rejects.toThrow('Forbidden')

    const admin = await createUser({ role: 'ADMIN' })
    await expect(releaseGroupSeat(start.groupId, placeholder.id, sessionFor(admin.id, 'ADMIN'))).resolves.toBeUndefined()
  })

  it('refuses to release the head delegate\'s own seat', async () => {
    const { mun, product, session } = await setup()
    const start = await initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize: 2 }, session)
    await expect(releaseGroupSeat(start.groupId, start.headRegistrationId, session)).rejects.toThrow(
      GROUP_ERRORS.cannotReleaseHead,
    )
  })

  it('refuses a slot that has not been claimed by anyone', async () => {
    const { mun, product, session } = await setup()
    const start = await initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize: 2 }, session)
    const [placeholder] = await db
      .select()
      .from(registrations)
      .where(and(eq(registrations.registrationGroupId, start.groupId), ne(registrations.id, start.headRegistrationId)))

    await expect(releaseGroupSeat(start.groupId, placeholder.id, session)).rejects.toThrow(GROUP_ERRORS.notClaimed)
  })

  it('refuses a registrationId that does not belong to this group', async () => {
    const { session } = await setup()
    const other = await setup()
    const otherStart = await initiateGroupRegistration(
      { munId: other.mun.id, registrationProductId: other.product.id, teamSize: 2 },
      other.session,
    )

    // The caller's own group exists, but the target registration belongs to
    // a different group entirely.
    const { mun, product } = await setup()
    const mine = await initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize: 2 }, session)

    await expect(releaseGroupSeat(mine.groupId, otherStart.headRegistrationId, session)).rejects.toThrow(
      GROUP_ERRORS.notFound,
    )
  })

  it('refuses once the team has actually paid — the seat stays claimed, unchanged', async () => {
    const { groupId, session } = await startAndPayGroup(2)
    const adapter = mockAdapter()
    const friendEmail = `friend-${crypto.randomUUID()}@test.dev`
    await inviteGroupMember(groupId, friendEmail, 'Friend', APP_URL, session, adapter)
    const rawToken = new URL(adapter.send.mock.calls[0][0].body.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!
    const invitee = await createUser({ email: friendEmail })
    const accepted = await acceptGroupInvitation(rawToken, { fullName: 'Friend' }, sessionFor(invitee.id))

    await expect(releaseGroupSeat(groupId, accepted.registrationId, session)).rejects.toThrow(GROUP_ERRORS.alreadyPaid)

    const [row] = await db.select().from(registrations).where(eq(registrations.id, accepted.registrationId))
    expect(row.userId).toBe(invitee.id)
    expect(row.status).toBe('CONFIRMED')
  })

  it('releases a claimed-but-unpaid seat back to the head, and the reopened slot can be invited to again once paid — capacity stays at teamSize', async () => {
    // teamSize 2 keeps exactly one non-head slot, so which slot the later
    // invite lands on is unambiguous.
    const { mun, product, session, head } = await setup()
    const start = await initiateGroupRegistration({ munId: mun.id, registrationProductId: product.id, teamSize: 2 }, session)
    const [placeholder] = await db
      .select()
      .from(registrations)
      .where(and(eq(registrations.registrationGroupId, start.groupId), ne(registrations.id, start.headRegistrationId)))

    const wrongPerson = await createUser()
    await claimSlotDirectly(placeholder.id, wrongPerson)

    await releaseGroupSeat(start.groupId, placeholder.id, session)

    const [released] = await db.select().from(registrations).where(eq(registrations.id, placeholder.id))
    expect(released.userId).toBe(head.id)
    expect(released.formResponses).toBeNull()
    expect(released.status).toBe('PAYMENT_PENDING') // untouched by the release itself

    // Total rows in the group is still exactly teamSize — release reuses the
    // existing row rather than creating or destroying a seat.
    const allRows = await db.select().from(registrations).where(eq(registrations.registrationGroupId, start.groupId))
    expect(allRows).toHaveLength(2)

    // Now the team pays, and the reopened seat is genuinely invitable again.
    await db.update(registrations).set({ status: 'CONFIRMED' }).where(eq(registrations.registrationGroupId, start.groupId))
    const adapter = mockAdapter()
    const invitation = await inviteGroupMember(start.groupId, 'replacement@test.dev', undefined, APP_URL, session, adapter)
    expect(invitation.email).toBe('replacement@test.dev')

    const roster = await getGroupRoster(start.groupId, session)
    expect(roster.slots.find((s) => s.registrationId === placeholder.id)?.invitation).toMatchObject({
      status: 'PENDING',
      email: 'replacement@test.dev',
    })
  })
})

afterAll(async () => {
  await db.$client.end()
})
