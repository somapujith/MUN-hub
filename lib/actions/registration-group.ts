import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, payments, registrationGroupInvitations, registrationGroups, registrationProducts, registrations, users } from '@/lib/db/schema'
import type { PaymentStatus, RegistrationGroupInvitationStatus, RegistrationStatus } from '@/lib/db/schema-enums'
import type { Session } from '@/lib/auth/adapter'
import { generateOpaqueToken, hashOpaqueToken } from '@/lib/auth/opaque-token'
import { getNotificationsAdapter } from '@/lib/notifications/select-adapter'
import type { NotificationsAdapter } from '@/lib/notifications/adapter'
import { ACTIVE_REGISTRATION_STATUSES } from './registration'

// -----------------------------------------------------------------------------
// registration-group — head-delegate management of a group/delegation
// registration: roster, invite, resend, cancel, accept. Payment itself is
// entirely handled by initiateGroupRegistration (lib/actions/registration.ts)
// and the existing payments webhook (lib/payments/webhook.ts) — nothing here
// ever charges anyone. Full design: docs/autonomous-run/changes/lane-delegation.md.
//
// Slot terminology (see schema.ts's registrationGroups/registrationGroupInvitations
// header comments): a "slot" is one `registrations` row belonging to a group.
// The head's own slot is `group.headRegistrationId`. Every other slot starts
// out temporarily owned by the head (`registrations.userId = group.headUserId`)
// and is "claimed" the moment a teammate accepts an invitation for it —
// `registrations.userId` is reassigned to them. A slot with no PENDING,
// unexpired invitation is "open" and can be (re-)invited.
// -----------------------------------------------------------------------------

export const GROUP_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const GROUP_INVITATION_RESEND_COOLDOWN_MS = 60 * 1000

/** Thrown-message constants — see server/middleware/error.ts for the HTTP status each maps to. */
export const GROUP_ERRORS = {
  notFound: 'Team not found',
  notPaid: "Invitations can only be sent once the team's registration is paid",
  cancelled: "This team's registration was cancelled",
  full: 'All team seats already have an invitation',
  invalidInvite: 'This invitation link is invalid or has expired',
  alreadyMember: 'You are already part of this team',
  isHead: 'You are already the head of this team',
  resendCooldown: 'Please wait a moment before resending this invitation',
  notPending: 'This invitation can no longer be resent or cancelled',
  cannotReleaseHead: "You can't release your own seat",
  notClaimed: "This seat hasn't been claimed by anyone yet",
  alreadyPaid: "Your team has already paid — this seat can no longer be released. Contact support to make a change.",
} as const

/** Pre-payment hold statuses — mirrors `RELEASABLE_STATUSES` in `lib/actions/registration.ts`. A group's seats all share one status until the team's single payment confirms them together (see `reserveGroupAndStartPayment`); `CONFIRMED`/`ATTENDED`/`NO_SHOW` all mean the team has paid (or, for a free pass, been finalized the same way). */
const GROUP_PRE_PAYMENT_STATUSES: readonly RegistrationStatus[] = ['PENDING', 'PAYMENT_PENDING']

interface GroupRow {
  id: string
  munId: string
  registrationProductId: string
  headUserId: string
  headRegistrationId: string | null
  teamSize: number
  paymentId: string | null
}

async function loadGroup(groupId: string): Promise<GroupRow> {
  const [group] = await db.select().from(registrationGroups).where(eq(registrationGroups.id, groupId)).limit(1)
  if (!group) throw new Error(GROUP_ERRORS.notFound)
  return group
}

/** Throws `Forbidden` unless `session` is the group's own head delegate or platform staff. */
function assertHeadOrAdmin(group: GroupRow, session: Session | null): Session {
  if (!session) throw new Error('Forbidden')
  const isStaff = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN'
  if (session.userId !== group.headUserId && !isStaff) throw new Error('Forbidden')
  return session
}

/** Flips any PENDING invitation for `groupId` whose `expiresAt` has passed to EXPIRED — lazy sweep, same pattern as `sweepExpiredHolds` (lib/actions/registration.ts). */
async function expireStaleInvitations(groupId: string, now: Date = new Date()): Promise<void> {
  await db
    .update(registrationGroupInvitations)
    .set({ status: 'EXPIRED' })
    .where(
      and(
        eq(registrationGroupInvitations.groupId, groupId),
        eq(registrationGroupInvitations.status, 'PENDING'),
        lt(registrationGroupInvitations.expiresAt, now),
      ),
    )
}

// ---------------------------------------------------------------------------
// Roster (head-facing)
// ---------------------------------------------------------------------------

export interface GroupRosterSlot {
  registrationId: string
  isHead: boolean
  /** Set once the slot is claimed (the head's own slot, or an accepted teammate). */
  member: { name: string; email: string } | null
  registrationStatus: RegistrationStatus
  /** The slot's most recent invitation, if any has ever been sent for it (any status). Null for a never-invited open slot. */
  invitation: {
    id: string
    email: string
    invitedName: string | null
    status: RegistrationGroupInvitationStatus
    expiresAt: Date
  } | null
}

export interface GroupRoster {
  id: string
  munId: string
  munName: string
  munSlug: string
  productName: string
  teamSize: number
  headUserId: string
  headRegistrationId: string
  /** All slots in the group move together — this is the head's (and so every slot's) shared status. */
  status: RegistrationStatus
  payment: { amount: number; currency: string; status: PaymentStatus } | null
  slots: GroupRosterSlot[]
}

/** Head delegate's (or staff's) full view of a group: who's joined, who's pending, who hasn't been invited yet. */
export async function getGroupRoster(groupId: string, session: Session | null): Promise<GroupRoster> {
  const group = await loadGroup(groupId)
  assertHeadOrAdmin(group, session)
  if (!group.headRegistrationId) throw new Error(GROUP_ERRORS.notFound)

  await expireStaleInvitations(groupId)

  const [mun] = await db.select({ name: muns.name, slug: muns.slug }).from(muns).where(eq(muns.id, group.munId)).limit(1)
  const [product] = await db
    .select({ name: registrationProducts.name })
    .from(registrationProducts)
    .where(eq(registrationProducts.id, group.registrationProductId))
    .limit(1)
  if (!mun || !product) throw new Error(GROUP_ERRORS.notFound)

  const payment = group.paymentId
    ? (
        await db
          .select({ amount: payments.amount, currency: payments.currency, status: payments.status })
          .from(payments)
          .where(eq(payments.id, group.paymentId))
          .limit(1)
      ).at(0)
    : undefined

  const members = await db
    .select({
      id: registrations.id,
      userId: registrations.userId,
      status: registrations.status,
      name: users.name,
      email: users.email,
    })
    .from(registrations)
    .innerJoin(users, eq(users.id, registrations.userId))
    .where(eq(registrations.registrationGroupId, groupId))
    .orderBy(registrations.createdAt)

  const invitations = await db
    .select()
    .from(registrationGroupInvitations)
    .where(eq(registrationGroupInvitations.groupId, groupId))
    .orderBy(registrationGroupInvitations.createdAt)

  // Latest invitation per slot wins (a cancelled-then-re-invited slot has two rows).
  const latestInvitationByRegistration = new Map<string, (typeof invitations)[number]>()
  for (const invitation of invitations) {
    latestInvitationByRegistration.set(invitation.registrationId, invitation)
  }

  const headRow = members.find((m) => m.id === group.headRegistrationId)
  const status = headRow?.status ?? 'PENDING'

  const slots: GroupRosterSlot[] = members.map((row) => {
    const isHead = row.id === group.headRegistrationId
    const claimed = isHead || row.userId !== group.headUserId
    const invitation = latestInvitationByRegistration.get(row.id) ?? null
    return {
      registrationId: row.id,
      isHead,
      member: claimed ? { name: row.name, email: row.email } : null,
      registrationStatus: row.status,
      invitation:
        !claimed && invitation
          ? {
              id: invitation.id,
              email: invitation.email,
              invitedName: invitation.invitedName,
              status: invitation.status,
              expiresAt: invitation.expiresAt,
            }
          : null,
    }
  })

  return {
    id: group.id,
    munId: group.munId,
    munName: mun.name,
    munSlug: mun.slug,
    productName: product.name,
    teamSize: group.teamSize,
    headUserId: group.headUserId,
    headRegistrationId: group.headRegistrationId,
    status,
    payment: payment ? { amount: payment.amount, currency: payment.currency, status: payment.status } : null,
    slots,
  }
}

// ---------------------------------------------------------------------------
// Invite / resend / cancel (head-facing writes)
// ---------------------------------------------------------------------------

export interface GroupInvitationSummary {
  id: string
  email: string
  invitedName: string | null
  expiresAt: Date
}

function buildInviteEmail(
  rawToken: string,
  appUrl: string,
  headName: string,
  munName: string,
): { subject: string; body: string; url: string } {
  const url = `${appUrl}/group-invite?token=${rawToken}`
  return {
    subject: `${headName} invited you to join their team for ${munName} — MUN Hub`,
    body:
      `Hi,\n\n` +
      `${headName} has registered a team for "${munName}" on MUN Hub and reserved a seat for you — ` +
      `already paid for, nothing to pay yourself.\n\n` +
      `Accept the invitation and fill in your delegate details here. This link expires in 7 days ` +
      `and can only be used once:\n${url}\n\n` +
      `If you weren't expecting this, you can ignore this email.`,
    url,
  }
}

/**
 * Sends (or re-sends into a fresh slot) an invitation for one team seat.
 * Only legal once the group's own registration is CONFIRMED (paid) — there
 * is no per-member payment step, so inviting before payment would let a
 * teammate accept a seat that could still lapse unpaid.
 */
export async function inviteGroupMember(
  groupId: string,
  email: string,
  invitedName: string | undefined,
  appUrl: string,
  session: Session | null,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<GroupInvitationSummary> {
  const group = await loadGroup(groupId)
  assertHeadOrAdmin(group, session)
  if (!group.headRegistrationId) throw new Error(GROUP_ERRORS.notFound)

  const normalizedEmail = email.trim().toLowerCase()
  const trimmedName = invitedName?.trim() || null

  const [headRegistration] = await db
    .select({ status: registrations.status })
    .from(registrations)
    .where(eq(registrations.id, group.headRegistrationId))
    .limit(1)
  if (!headRegistration) throw new Error(GROUP_ERRORS.notFound)
  if (headRegistration.status === 'CANCELLED') throw new Error(GROUP_ERRORS.cancelled)
  if (headRegistration.status !== 'CONFIRMED') throw new Error(GROUP_ERRORS.notPaid)

  await expireStaleInvitations(groupId)

  const [mun] = await db.select({ name: muns.name }).from(muns).where(eq(muns.id, group.munId)).limit(1)
  const [headUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, group.headUserId)).limit(1)
  if (!mun || !headUser) throw new Error(GROUP_ERRORS.notFound)

  const now = new Date()
  const rawToken = generateOpaqueToken()

  const created = await db.transaction(async (tx) => {
    // Lock every non-head slot in this group so two concurrent invite calls
    // can't both claim the same open seat.
    const candidates = await tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.registrationGroupId, groupId),
          eq(registrations.userId, group.headUserId),
          ne(registrations.id, group.headRegistrationId!),
        ),
      )
      .for('update')

    if (candidates.length === 0) throw new Error(GROUP_ERRORS.full)

    const liveInvites = await tx
      .select({ registrationId: registrationGroupInvitations.registrationId })
      .from(registrationGroupInvitations)
      .where(
        and(
          inArray(
            registrationGroupInvitations.registrationId,
            candidates.map((c) => c.id),
          ),
          eq(registrationGroupInvitations.status, 'PENDING'),
          gt(registrationGroupInvitations.expiresAt, now),
        ),
      )
    const taken = new Set(liveInvites.map((r) => r.registrationId))
    const openSlot = candidates.find((c) => !taken.has(c.id))
    if (!openSlot) throw new Error(GROUP_ERRORS.full)

    const [invitation] = await tx
      .insert(registrationGroupInvitations)
      .values({
        groupId,
        registrationId: openSlot.id,
        email: normalizedEmail,
        invitedName: trimmedName,
        tokenHash: hashOpaqueToken(rawToken),
        status: 'PENDING',
        expiresAt: new Date(now.getTime() + GROUP_INVITATION_TTL_MS),
        createdAt: now,
        lastSentAt: now,
      })
      .returning({ id: registrationGroupInvitations.id, expiresAt: registrationGroupInvitations.expiresAt })

    return invitation
  })

  const mail = buildInviteEmail(rawToken, appUrl, headUser.name, mun.name)
  try {
    await adapter.send({ to: normalizedEmail, subject: mail.subject, body: mail.body })
  } catch (error) {
    console.error('[registration-group] invite delivery failed', { groupId, invitationId: created.id, error })
  }

  return { id: created.id, email: normalizedEmail, invitedName: trimmedName, expiresAt: created.expiresAt }
}

/** Rotates the token and extends the expiry of a still-PENDING invitation, and re-sends the email. 60-second cooldown per invitation. */
export async function resendGroupInvitation(
  invitationId: string,
  appUrl: string,
  session: Session | null,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<GroupInvitationSummary> {
  const [invitation] = await db
    .select()
    .from(registrationGroupInvitations)
    .where(eq(registrationGroupInvitations.id, invitationId))
    .limit(1)
  if (!invitation) throw new Error(GROUP_ERRORS.invalidInvite)

  const group = await loadGroup(invitation.groupId)
  assertHeadOrAdmin(group, session)

  await expireStaleInvitations(group.id)
  const [fresh] = await db
    .select({ status: registrationGroupInvitations.status, lastSentAt: registrationGroupInvitations.lastSentAt })
    .from(registrationGroupInvitations)
    .where(eq(registrationGroupInvitations.id, invitationId))
    .limit(1)
  if (!fresh || fresh.status !== 'PENDING') throw new Error(GROUP_ERRORS.notPending)

  const now = new Date()
  if (now.getTime() - fresh.lastSentAt.getTime() < GROUP_INVITATION_RESEND_COOLDOWN_MS) {
    throw new Error(GROUP_ERRORS.resendCooldown)
  }

  const [mun] = await db.select({ name: muns.name }).from(muns).where(eq(muns.id, group.munId)).limit(1)
  const [headUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, group.headUserId)).limit(1)
  if (!mun || !headUser) throw new Error(GROUP_ERRORS.notFound)

  const rawToken = generateOpaqueToken()
  const expiresAt = new Date(now.getTime() + GROUP_INVITATION_TTL_MS)
  await db
    .update(registrationGroupInvitations)
    .set({ tokenHash: hashOpaqueToken(rawToken), expiresAt, lastSentAt: now })
    .where(eq(registrationGroupInvitations.id, invitationId))

  const mail = buildInviteEmail(rawToken, appUrl, headUser.name, mun.name)
  try {
    await adapter.send({ to: invitation.email, subject: mail.subject, body: mail.body })
  } catch (error) {
    console.error('[registration-group] resend delivery failed', { invitationId, error })
  }

  return { id: invitationId, email: invitation.email, invitedName: invitation.invitedName, expiresAt }
}

/** Cancels a PENDING invitation, freeing its slot for a fresh invite to a different address. Does not touch the underlying registration row. */
export async function cancelGroupInvitation(invitationId: string, session: Session | null): Promise<void> {
  const [invitation] = await db
    .select({ id: registrationGroupInvitations.id, groupId: registrationGroupInvitations.groupId, status: registrationGroupInvitations.status })
    .from(registrationGroupInvitations)
    .where(eq(registrationGroupInvitations.id, invitationId))
    .limit(1)
  if (!invitation) throw new Error(GROUP_ERRORS.invalidInvite)

  const group = await loadGroup(invitation.groupId)
  assertHeadOrAdmin(group, session)

  if (invitation.status !== 'PENDING') throw new Error(GROUP_ERRORS.notPending)

  await db
    .update(registrationGroupInvitations)
    .set({ status: 'CANCELLED', cancelledAt: new Date() })
    .where(and(eq(registrationGroupInvitations.id, invitationId), eq(registrationGroupInvitations.status, 'PENDING')))
}

/**
 * Undoes an accepted teammate's claim on a seat — the "wrong person
 * accepted", "this teammate dropped out and I need to swap someone in" fix —
 * by handing the slot back to the head, exactly the shape
 * `reserveGroupAndStartPayment` created it in (owned by the head, no
 * answers). That makes it an "open" slot again by every check
 * `inviteGroupMember` already makes, so the head can invite a replacement
 * into it with no other change needed.
 *
 * Deliberately refused once the team has actually paid (`CONFIRMED` or
 * later — see `GROUP_PRE_PAYMENT_STATUSES`): undoing a claim on an
 * already-paid seat is a different, larger problem than this fix covers —
 * it's tangled up with whether anything is owed back, and MUN Hub has no
 * refunds — so that path needs its own product decision and isn't built
 * here. Callers should treat `GROUP_ERRORS.alreadyPaid` as "don't offer this
 * control once paid" rather than a recoverable error to retry.
 *
 * The superseded invitation (already `ACCEPTED`, a terminal status) is left
 * untouched — same append-only stance `cancelGroupInvitation` takes with
 * `CANCELLED` ones; a slot's invitation history is never rewritten, only
 * added to.
 */
export async function releaseGroupSeat(
  groupId: string,
  registrationId: string,
  session: Session | null,
): Promise<void> {
  const group = await loadGroup(groupId)
  assertHeadOrAdmin(group, session)
  if (!group.headRegistrationId) throw new Error(GROUP_ERRORS.notFound)
  if (registrationId === group.headRegistrationId) throw new Error(GROUP_ERRORS.cannotReleaseHead)

  await db.transaction(async (tx) => {
    const [slot] = await tx
      .select({
        id: registrations.id,
        userId: registrations.userId,
        status: registrations.status,
        registrationGroupId: registrations.registrationGroupId,
      })
      .from(registrations)
      .where(eq(registrations.id, registrationId))
      .for('update')
      .limit(1)
    if (!slot || slot.registrationGroupId !== groupId) throw new Error(GROUP_ERRORS.notFound)
    if (slot.userId === group.headUserId) throw new Error(GROUP_ERRORS.notClaimed)
    if (!GROUP_PRE_PAYMENT_STATUSES.includes(slot.status)) throw new Error(GROUP_ERRORS.alreadyPaid)

    await tx
      .update(registrations)
      .set({ userId: group.headUserId, formResponses: null, updatedAt: new Date() })
      .where(eq(registrations.id, registrationId))
  })
}

// ---------------------------------------------------------------------------
// Invitation accept flow (invitee-facing)
// ---------------------------------------------------------------------------

export interface GroupInvitationPreview {
  status: RegistrationGroupInvitationStatus
  munName: string
  munSlug: string
  productName: string
  headName: string
  invitedEmail: string
}

/** Public, unauthenticated — lets the accept page show who invited whom to what before asking the visitor to sign in. */
export async function getInvitationPreview(token: string): Promise<GroupInvitationPreview> {
  const tokenHash = hashOpaqueToken(token)
  const [invitation] = await db
    .select()
    .from(registrationGroupInvitations)
    .where(eq(registrationGroupInvitations.tokenHash, tokenHash))
    .limit(1)
  if (!invitation) throw new Error(GROUP_ERRORS.invalidInvite)

  await expireStaleInvitations(invitation.groupId)
  const [fresh] = await db
    .select({ status: registrationGroupInvitations.status })
    .from(registrationGroupInvitations)
    .where(eq(registrationGroupInvitations.id, invitation.id))
    .limit(1)

  const group = await loadGroup(invitation.groupId)
  const [mun] = await db.select({ name: muns.name, slug: muns.slug }).from(muns).where(eq(muns.id, group.munId)).limit(1)
  const [product] = await db
    .select({ name: registrationProducts.name })
    .from(registrationProducts)
    .where(eq(registrationProducts.id, group.registrationProductId))
    .limit(1)
  const [headUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, group.headUserId)).limit(1)
  if (!mun || !product || !headUser) throw new Error(GROUP_ERRORS.notFound)

  return {
    status: fresh?.status ?? invitation.status,
    munName: mun.name,
    munSlug: mun.slug,
    productName: product.name,
    headName: headUser.name,
    invitedEmail: invitation.email,
  }
}

export interface AcceptedGroupInvitation {
  registrationId: string
  munSlug: string
}

/**
 * Claims one group slot: reassigns its registration row to the signed-in
 * caller and records their registration-form answers, in one transaction.
 * No payment happens here — the team's single payment already confirmed
 * every seat.
 *
 * Requires a session (Forbidden otherwise). Throws `GROUP_ERRORS.invalidInvite`
 * for an unknown/expired/already-consumed token — deliberately the same
 * message for every "can't use this token" case, same no-enumeration stance
 * as password-reset/email-verification's own token checks.
 */
export async function acceptGroupInvitation(
  token: string,
  formResponses: Record<string, unknown> | undefined,
  session: Session | null,
): Promise<AcceptedGroupInvitation> {
  if (!session) throw new Error('Forbidden')

  const tokenHash = hashOpaqueToken(token)

  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(registrationGroupInvitations)
      .where(eq(registrationGroupInvitations.tokenHash, tokenHash))
      .for('update')
      .limit(1)
    if (!invitation) throw new Error(GROUP_ERRORS.invalidInvite)

    const now = new Date()
    if (invitation.status !== 'PENDING' || invitation.expiresAt < now) {
      if (invitation.status === 'PENDING' && invitation.expiresAt < now) {
        await tx.update(registrationGroupInvitations).set({ status: 'EXPIRED' }).where(eq(registrationGroupInvitations.id, invitation.id))
      }
      throw new Error(GROUP_ERRORS.invalidInvite)
    }

    const [group] = await tx
      .select()
      .from(registrationGroups)
      .where(eq(registrationGroups.id, invitation.groupId))
      .limit(1)
    if (!group) throw new Error(GROUP_ERRORS.notFound)

    if (session.userId === group.headUserId) throw new Error(GROUP_ERRORS.isHead)

    const [slot] = await tx
      .select({ id: registrations.id, userId: registrations.userId, status: registrations.status, munId: registrations.munId })
      .from(registrations)
      .where(eq(registrations.id, invitation.registrationId))
      .for('update')
      .limit(1)
    if (!slot) throw new Error(GROUP_ERRORS.notFound)
    // A slot claimed (or released) since the invitation was sent — never
    // trust the invitation's own state alone.
    if (slot.userId !== group.headUserId) throw new Error(GROUP_ERRORS.invalidInvite)
    if (slot.status === 'CANCELLED') throw new Error(GROUP_ERRORS.cancelled)
    if (slot.status !== 'CONFIRMED') throw new Error(GROUP_ERRORS.notPaid)

    const alreadyInGroup = await tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(and(eq(registrations.registrationGroupId, group.id), eq(registrations.userId, session.userId)))
      .limit(1)
    if (alreadyInGroup.length > 0) throw new Error(GROUP_ERRORS.alreadyMember)

    const activeElsewhere = await tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.registrationProductId, group.registrationProductId),
          eq(registrations.userId, session.userId),
          inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES),
        ),
      )
      .limit(1)
    if (activeElsewhere.length > 0) throw new Error('You already have an active registration for this product')

    await tx
      .update(registrations)
      .set({ userId: session.userId, formResponses: formResponses ?? {}, updatedAt: now })
      .where(eq(registrations.id, slot.id))

    await tx
      .update(registrationGroupInvitations)
      .set({ status: 'ACCEPTED', acceptedAt: now })
      .where(eq(registrationGroupInvitations.id, invitation.id))

    const [mun] = await tx.select({ slug: muns.slug }).from(muns).where(eq(muns.id, slot.munId)).limit(1)
    if (!mun) throw new Error(GROUP_ERRORS.notFound)

    return { registrationId: slot.id, munSlug: mun.slug }
  })
}
