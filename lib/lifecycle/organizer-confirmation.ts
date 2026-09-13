import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, committees, portfolios, registrationProducts, organizerConfirmations } from '@/lib/db/schema'
import type { Mun } from '@/lib/types'
import type { Session } from '@/lib/auth/adapter'
import { transitionMun } from './mun-state-machine'

async function buildSnapshot(munId: string) {
  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  const munCommittees = await db.select().from(committees).where(eq(committees.munId, munId))
  const committeeIds = munCommittees.map((c) => c.id)
  const munPortfolios = committeeIds.length
    ? await db.select().from(portfolios).where(inArray(portfolios.committeeId, committeeIds))
    : []
  const munProducts = await db.select().from(registrationProducts).where(eq(registrationProducts.munId, munId))

  return {
    mun,
    committees: munCommittees,
    portfolios: munPortfolios,
    registrationProducts: munProducts,
  }
}

/**
 * Organizer Final Confirmation (PRD Section 14, Gate 3): the organizer
 * reviews a complete summary of their submission and confirms it's accurate,
 * complete, and authorized for publication. Snapshots the current mun +
 * committees + portfolios + products into `organizer_confirmations`, then
 * advances the mun CONTENT_SUBMITTED -> ORGANIZER_CONFIRMATION -> VERIFICATION
 * as two separate audit-logged transitions (not collapsed into one jump) so
 * the lifecycle's real two-step shape shows up in the audit trail.
 */
export async function submitFinalConfirmation(munId: string, session: Session | null): Promise<Mun> {
  if (!session) throw new Error('Forbidden')

  const [mun] = await db.select().from(muns).where(eq(muns.id, munId)).limit(1)
  if (!mun) throw new Error('Mun not found')
  if (mun.organizerId !== session.userId && session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN') {
    throw new Error('Forbidden')
  }
  if (mun.status !== 'CONTENT_SUBMITTED') {
    throw new Error(`Cannot submit final confirmation from status ${mun.status}`)
  }

  const [priorConfirmation] = await db
    .select({ versionNumber: organizerConfirmations.versionNumber })
    .from(organizerConfirmations)
    .where(eq(organizerConfirmations.munId, munId))
    .orderBy(organizerConfirmations.versionNumber)

  const nextVersion = (priorConfirmation?.versionNumber ?? 0) + 1
  const snapshot = await buildSnapshot(munId)

  await db.insert(organizerConfirmations).values({
    munId,
    confirmingUserId: session.userId,
    versionNumber: nextVersion,
    snapshotJson: snapshot,
  })

  await transitionMun(munId, 'ORGANIZER_CONFIRMATION', session.userId, 'Organizer submitted final confirmation')
  return transitionMun(munId, 'VERIFICATION', session.userId, 'Auto-advanced to MUNHub verification')
}
