import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { passwordResetTokens, sessions, users } from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'
import type { AdminAction, Role } from '@/lib/db/schema-enums'
import { recordAdminAction } from '@/lib/audit/log'
import { insertPasswordResetToken } from './password-reset'

// -----------------------------------------------------------------------------
// Staff management — the /admin/staff console (OPERATIONS/ADMIN/SUPER_ADMIN
// accounts). Reads are open to every staff role; every write is SUPER_ADMIN
// only. Organizer accounts are managed in organizer-admin.ts, never here, and
// that file refuses to touch staff accounts.
//
// Audit trail: admin_actions has no staff-specific enum values yet and this
// run adds no migrations, so each write stores the closest existing value —
// USER_SUSPENDED for a suspension, ORGANIZER_REINSTATED for every
// access-granting change (account created, role changed, reinstated,
// set-password link issued) — and always records the precise event name in
// `metadata.event` (STAFF_CREATED, STAFF_ROLE_CHANGED, ...). The platform
// audit feed (admin-audit.ts#listAdminActions) displays `metadata.event` when
// present. Dedicated enum values are a follow-up.
//
// Set-password links: `mintSetPasswordLink` below mints its token through
// password-reset.ts#insertPasswordResetToken (which stores only the token's
// SHA-256) and returns the link; resetPassword() consumes it unchanged.
// -----------------------------------------------------------------------------

export const STAFF_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const satisfies readonly Role[]
export type StaffRole = (typeof STAFF_ROLES)[number]

const MANAGE_ROLES = ['SUPER_ADMIN'] as const

/** How long a staff set-password link stays valid — longer than a self-serve reset (1h) because it is relayed by a person. */
export const STAFF_SET_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000

/** Error messages thrown by this file. server/routes/admin-staff.ts maps them to HTTP statuses. */
export const STAFF_ERRORS = {
  notFound: 'Staff member not found',
  self: 'You cannot change your own staff account here',
  alreadySuspended: 'This staff member is already suspended',
  notSuspended: 'This staff member is not suspended',
  suspendedNoLink: 'Reinstate this staff member before issuing a set-password link',
  invalidEmail: 'Enter a valid email address',
  invalidRole: 'Role must be OPERATIONS, ADMIN or SUPER_ADMIN',
  reasonRequired: 'A reason is required to suspend a staff member',
  nameRequired: 'Name is required',
} as const

/** Same message lib/actions/auth.ts uses, so the API's existing 409 mapping applies. */
const EMAIL_TAKEN = 'An account with that email already exists'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = Tx | typeof db

export interface StaffRow {
  id: string
  name: string
  email: string
  role: StaffRole
  suspended: boolean
  suspendedReason: string | null
  suspendedAt: Date | null
  createdAt: Date
  /** False until the account's first set-password link has been used. */
  passwordSet: boolean
}

export interface SetPasswordLink {
  setPasswordUrl: string
  expiresAt: Date
}

export interface CreateStaffResult extends SetPasswordLink {
  staff: StaffRow
}

// Never selects passwordHash itself — only whether one exists.
const STAFF_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  suspended: users.suspended,
  suspendedReason: users.suspendedReason,
  suspendedAt: users.suspendedAt,
  createdAt: users.createdAt,
  passwordSet: sql<boolean>`${users.passwordHash} is not null`,
}

function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role)
}

function toStaffRow(row: { role: Role } & Omit<StaffRow, 'role'>): StaffRow {
  if (!isStaffRole(row.role)) throw new Error(STAFF_ERRORS.notFound)
  return { ...row, role: row.role }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (!EMAIL_PATTERN.test(normalized)) throw new Error(STAFF_ERRORS.invalidEmail)
  return normalized
}

function assertStaffRole(role: string): asserts role is StaffRole {
  if (!isStaffRole(role)) throw new Error(STAFF_ERRORS.invalidRole)
}

/**
 * Creates a single-use set-password link for `userId` and retires any older
 * unused links for the same account, so only the newest link works. The token
 * row has the same shape `requestPasswordReset` writes, which is what
 * `resetPassword` consumes. Performs no authorization: call it only after a
 * SUPER_ADMIN check, or from the local bootstrap script.
 */
export async function mintSetPasswordLink(
  executor: Executor,
  userId: string,
  appUrl: string,
): Promise<SetPasswordLink> {
  const now = new Date()
  await executor
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)))

  const expiresAt = new Date(now.getTime() + STAFF_SET_PASSWORD_TTL_MS)
  const token = await insertPasswordResetToken(executor, userId, expiresAt, now)

  return { setPasswordUrl: `${appUrl.replace(/\/+$/, '')}/reset-password?token=${token}`, expiresAt }
}

/**
 * Row-locks every SUPER_ADMIN account (in id order, so concurrent callers
 * lock in the same order) and checks, under that lock, that the actor is
 * still an active SUPER_ADMIN. Every write here takes this lock before
 * touching its target.
 *
 * This is what keeps at least one super admin in charge. A write can only
 * demote or suspend someone other than the actor, and the actor is an active
 * SUPER_ADMIN at commit time, so one always remains. Two super admins
 * demoting or suspending each other at the same moment serialize on this
 * lock: the second one re-reads the rows after the first commits, no longer
 * matches role = SUPER_ADMIN (or is suspended), and gets Forbidden.
 */
export async function lockSuperAdmins(tx: Tx, actorId: string): Promise<void> {
  const rows = await tx
    .select({ id: users.id, suspended: users.suspended })
    .from(users)
    .where(eq(users.role, 'SUPER_ADMIN'))
    .orderBy(asc(users.id))
    .for('update')

  if (!rows.some((row) => row.id === actorId && !row.suspended)) {
    throw new Error('Forbidden')
  }
}

/**
 * Row-locks the target and returns it, or throws `notFound` unless it is a
 * staff account. Exported so every staff-account write — including
 * staff-mfa.ts's SUPER_ADMIN MFA reset, which lives in its own file — goes
 * through the same target check rather than trusting an arbitrary user id.
 */
export async function lockStaffTarget(tx: Tx, userId: string): Promise<StaffRow> {
  const [row] = await tx.select(STAFF_COLUMNS).from(users).where(eq(users.id, userId)).for('update').limit(1)
  if (!row || !isStaffRole(row.role)) throw new Error(STAFF_ERRORS.notFound)
  return toStaffRow(row)
}

async function audit(
  tx: Tx,
  actorId: string,
  action: AdminAction,
  targetId: string,
  event: string,
  reason?: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await recordAdminAction(tx, actorId, action, 'user', targetId, reason, { event, ...details })
}

export interface ListStaffParams {
  q?: string
  role?: StaffRole
  limit?: number
  offset?: number
}

export interface ListStaffResult {
  results: StaffRow[]
  total: number
}

/**
 * Staff directory: every OPERATIONS/ADMIN/SUPER_ADMIN account, highest role
 * first, then by name. Optional `q` matches name or email (case-insensitive
 * substring); optional `role` narrows to one staff role. Readable by any
 * staff role.
 */
export async function listStaff(params: ListStaffParams = {}, session: Session | null): Promise<ListStaffResult> {
  requireRole(session, [...STAFF_ROLES])

  const limit = params.limit ?? 50
  const offset = params.offset ?? 0
  const q = params.q?.trim()
  const escaped = q?.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  const whereClause = and(
    params.role ? eq(users.role, params.role) : inArray(users.role, [...STAFF_ROLES]),
    escaped ? or(ilike(users.name, `%${escaped}%`), ilike(users.email, `%${escaped}%`)) : undefined,
  )

  const rows = await db
    .select(STAFF_COLUMNS)
    .from(users)
    .where(whereClause)
    // role enum order is STUDENT < ORGANIZER < OPERATIONS < ADMIN < SUPER_ADMIN
    .orderBy(desc(users.role), asc(users.name), asc(users.id))
    .limit(limit)
    .offset(offset)

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(whereClause)

  return { results: rows.map(toStaffRow), total: count }
}

export interface CreateStaffInput {
  name: string
  email: string
  role: StaffRole
}

/**
 * SUPER_ADMIN creates a staff account with no password and gets back a
 * one-time set-password link to hand to the new staff member. Refuses an
 * email that already has any account (promoting a delegate or organizer
 * account into staff is deliberately not possible from the console).
 */
export async function createStaffAccount(
  input: CreateStaffInput,
  appUrl: string,
  session: Session | null,
): Promise<CreateStaffResult> {
  requireRole(session, [...MANAGE_ROLES])

  const name = input.name.trim()
  if (!name) throw new Error(STAFF_ERRORS.nameRequired)
  const email = normalizeEmail(input.email)
  assertStaffRole(input.role)
  const role = input.role

  return db.transaction(async (tx) => {
    await lockSuperAdmins(tx, session.userId)

    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
    if (existing) throw new Error(EMAIL_TAKEN)

    const [created] = await tx.insert(users).values({ name, email, role }).returning({ id: users.id })
    const link = await mintSetPasswordLink(tx, created.id, appUrl)
    await audit(tx, session.userId, 'ORGANIZER_REINSTATED', created.id, 'STAFF_CREATED', undefined, { role })

    const [row] = await tx.select(STAFF_COLUMNS).from(users).where(eq(users.id, created.id)).limit(1)
    return { staff: toStaffRow(row), ...link }
  })
}

/**
 * SUPER_ADMIN moves a staff account between OPERATIONS/ADMIN/SUPER_ADMIN.
 * Not on your own account (so the actor always remains a super admin — see
 * `lockSuperAdmins`). A no-op change returns the row without writing an audit
 * entry. Sessions are left alone: every request re-reads the role from the
 * users row.
 */
export async function changeStaffRole(userId: string, role: StaffRole, session: Session | null): Promise<StaffRow> {
  requireRole(session, [...MANAGE_ROLES])
  assertStaffRole(role)
  if (userId === session.userId) throw new Error(STAFF_ERRORS.self)

  return db.transaction(async (tx) => {
    await lockSuperAdmins(tx, session.userId)
    const target = await lockStaffTarget(tx, userId)
    if (target.role === role) return target

    await tx.update(users).set({ role }).where(eq(users.id, userId))
    await audit(tx, session.userId, 'ORGANIZER_REINSTATED', userId, 'STAFF_ROLE_CHANGED', undefined, {
      fromRole: target.role,
      toRole: role,
    })

    return { ...target, role }
  })
}

/**
 * SUPER_ADMIN suspends a staff account: blocks sign-in (session lookup and
 * sign-in both reject suspended users) and deletes the account's existing
 * sessions. Reason required. Not on your own account (so the actor always
 * remains an active super admin — see `lockSuperAdmins`).
 */
export async function suspendStaff(userId: string, reason: string, session: Session | null): Promise<StaffRow> {
  requireRole(session, [...MANAGE_ROLES])
  const trimmedReason = reason.trim()
  if (!trimmedReason) throw new Error(STAFF_ERRORS.reasonRequired)
  if (userId === session.userId) throw new Error(STAFF_ERRORS.self)

  return db.transaction(async (tx) => {
    await lockSuperAdmins(tx, session.userId)
    const target = await lockStaffTarget(tx, userId)
    if (target.suspended) throw new Error(STAFF_ERRORS.alreadySuspended)

    const suspendedAt = new Date()
    await tx
      .update(users)
      .set({ suspended: true, suspendedReason: trimmedReason, suspendedAt })
      .where(eq(users.id, userId))
    await tx.delete(sessions).where(eq(sessions.userId, userId))
    await audit(tx, session.userId, 'USER_SUSPENDED', userId, 'STAFF_SUSPENDED', trimmedReason, { role: target.role })

    return { ...target, suspended: true, suspendedReason: trimmedReason, suspendedAt }
  })
}

/** SUPER_ADMIN lifts a staff suspension. */
export async function reinstateStaff(userId: string, session: Session | null): Promise<StaffRow> {
  requireRole(session, [...MANAGE_ROLES])
  if (userId === session.userId) throw new Error(STAFF_ERRORS.self)

  return db.transaction(async (tx) => {
    await lockSuperAdmins(tx, session.userId)
    const target = await lockStaffTarget(tx, userId)
    if (!target.suspended) throw new Error(STAFF_ERRORS.notSuspended)

    await tx
      .update(users)
      .set({ suspended: false, suspendedReason: null, suspendedAt: null })
      .where(eq(users.id, userId))
    await audit(tx, session.userId, 'ORGANIZER_REINSTATED', userId, 'STAFF_REINSTATED', undefined, {
      role: target.role,
    })

    return { ...target, suspended: false, suspendedReason: null, suspendedAt: null }
  })
}

/**
 * SUPER_ADMIN issues a fresh set-password link for a staff account (the
 * first one expired, or the person lost access). Older unused links for the
 * account stop working. Not for a suspended account or your own.
 */
export async function issueStaffSetPasswordLink(
  userId: string,
  appUrl: string,
  session: Session | null,
): Promise<SetPasswordLink> {
  requireRole(session, [...MANAGE_ROLES])
  if (userId === session.userId) throw new Error(STAFF_ERRORS.self)

  return db.transaction(async (tx) => {
    await lockSuperAdmins(tx, session.userId)
    const target = await lockStaffTarget(tx, userId)
    if (target.suspended) throw new Error(STAFF_ERRORS.suspendedNoLink)

    const link = await mintSetPasswordLink(tx, userId, appUrl)
    // The token itself is never written to the audit log.
    await audit(tx, session.userId, 'ORGANIZER_REINSTATED', userId, 'STAFF_SET_PASSWORD_LINK_ISSUED', undefined, {
      expiresAt: link.expiresAt.toISOString(),
    })
    return link
  })
}

export interface BootstrapSuperAdminResult extends SetPasswordLink {
  userId: string
  created: boolean
  previousRole: Role | null
  wasSuspended: boolean
}

/**
 * Creates or promotes a SUPER_ADMIN by email and returns a set-password link.
 * No session: this is the break-glass path for scripts/create-admin.ts only,
 * which refuses to run against a non-local database unless explicitly
 * allowed. Never call it from a request handler. A suspended account is
 * reinstated, since recovering access is the point. The audit row names the
 * account itself as the actor (admin_actions.actor_id must be a real user).
 */
export async function bootstrapSuperAdmin(
  input: { email: string; name?: string },
  appUrl: string,
): Promise<BootstrapSuperAdminResult> {
  const email = normalizeEmail(input.email)
  const name = input.name?.trim() || email.split('@')[0]

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id, role: users.role, suspended: users.suspended })
      .from(users)
      .where(eq(users.email, email))
      .for('update')
      .limit(1)

    let userId: string
    if (existing) {
      userId = existing.id
      await tx
        .update(users)
        .set({ role: 'SUPER_ADMIN', suspended: false, suspendedReason: null, suspendedAt: null })
        .where(eq(users.id, userId))
    } else {
      const [created] = await tx
        .insert(users)
        .values({ name, email, role: 'SUPER_ADMIN' })
        .returning({ id: users.id })
      userId = created.id
    }

    const link = await mintSetPasswordLink(tx, userId, appUrl)
    await audit(tx, userId, 'ORGANIZER_REINSTATED', userId, 'SUPER_ADMIN_BOOTSTRAPPED', undefined, {
      via: 'scripts/create-admin.ts',
      created: !existing,
      previousRole: existing?.role ?? null,
      wasSuspended: existing?.suspended ?? false,
    })

    return {
      userId,
      created: !existing,
      previousRole: existing?.role ?? null,
      wasSuspended: existing?.suspended ?? false,
      ...link,
    }
  })
}
