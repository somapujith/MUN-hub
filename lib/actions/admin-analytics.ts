import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, payments, registrations, users } from '@/lib/db/schema'
import type { MunStatus, RegistrationStatus } from '@/lib/db/schema-enums'
import { registrationStatusEnum } from '@/lib/db/schema-enums'
import { requireRole } from '@/lib/auth/authorize'
import type { Session } from '@/lib/auth/adapter'

const ADMIN_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const

/** Statuses in which a MUN is live on the marketplace and running. */
export const LIVE_MUN_STATUSES: MunStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CONFERENCE_ACTIVE']

const NEW_ORGANIZER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface RevenueByCurrency {
  currency: string
  /** Sum of `payments.amount` over PAID payments (what delegates were charged). */
  gmv: number
  /** Sum of `payments.platformFeeAmount` over PAID payments that carry a fee breakdown. */
  platformFeeTotal: number
  paidPayments: number
  /** PAID payments created before the fee breakdown existed (null platform fee) — not in `platformFeeTotal`. */
  paidPaymentsWithoutFeeBreakdown: number
}

export interface AdminAnalytics {
  /** One entry per currency with at least one PAID payment, largest GMV first. */
  revenue: RevenueByCurrency[]
  registrationsByStatus: Record<RegistrationStatus, number>
  liveMuns: number
  newOrganizersLast7Days: number
  generatedAt: Date
}

/**
 * Platform totals for the /admin overview cards. GMV counts every PAID
 * payment, including one flagged as a payment exception (money was taken
 * either way; exceptions are resolved by an admin, there are no refunds).
 * Amounts are grouped by currency rather than summed across currencies.
 * Four aggregate queries, run in parallel.
 */
export async function getAdminAnalytics(session: Session | null, now: Date = new Date()): Promise<AdminAnalytics> {
  requireRole(session, [...ADMIN_ROLES])

  const [revenueRows, statusRows, [live], [newOrganizers]] = await Promise.all([
    db
      .select({
        currency: payments.currency,
        gmv: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`,
        platformFeeTotal: sql<number>`coalesce(sum(${payments.platformFeeAmount}), 0)::bigint`,
        paidPayments: sql<number>`count(*)::int`,
        paidPaymentsWithoutFeeBreakdown: sql<number>`count(*) filter (where ${payments.platformFeeAmount} is null)::int`,
      })
      .from(payments)
      .where(eq(payments.status, 'PAID'))
      .groupBy(payments.currency),
    db
      .select({ status: registrations.status, count: sql<number>`count(*)::int` })
      .from(registrations)
      .groupBy(registrations.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(muns)
      .where(inArray(muns.status, LIVE_MUN_STATUSES)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.role, 'ORGANIZER'),
          gte(users.createdAt, new Date(now.getTime() - NEW_ORGANIZER_WINDOW_MS)),
          lte(users.createdAt, now),
        ),
      ),
  ])

  const registrationsByStatus = Object.fromEntries(
    registrationStatusEnum.enumValues.map((status) => [status, 0]),
  ) as Record<RegistrationStatus, number>
  for (const { status, count } of statusRows) registrationsByStatus[status] = count

  const revenue = revenueRows
    .map((row) => ({
      currency: row.currency,
      // bigint sums come back from postgres-js as strings.
      gmv: Number(row.gmv),
      platformFeeTotal: Number(row.platformFeeTotal),
      paidPayments: row.paidPayments,
      paidPaymentsWithoutFeeBreakdown: row.paidPaymentsWithoutFeeBreakdown,
    }))
    .sort((a, b) => b.gmv - a.gmv)

  return {
    revenue,
    registrationsByStatus,
    liveMuns: live?.count ?? 0,
    newOrganizersLast7Days: newOrganizers?.count ?? 0,
    generatedAt: now,
  }
}
