import { and, eq, gte, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, registrationProducts, registrations, users } from '@/lib/db/schema'
import { getRuntimeEnv } from '@/lib/runtime-env'
import { getNotificationsAdapter } from './select-adapter'
import type { NotificationsAdapter } from './adapter'

const DIGEST_HOUR_IST = 9
const DIGEST_WINDOW_MINUTES = 5
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * True exactly once a day, for a 5-minute window starting at 09:00 IST —
 * the same "fixed instant inside a half-open window" idempotency trick
 * reminder-job.ts uses, just on a wall-clock time-of-day instead of a
 * per-row deadline. A reliable 5-minute cron cadence hits this window
 * exactly once per calendar day; nothing else needs to track "already sent
 * today."  Uses Intl.DateTimeFormat rather than manual UTC+5:30 arithmetic
 * so it can't drift out of sync with lib/lifecycle/sla.ts's own
 * Asia/Kolkata reference — both ultimately rely on the same IANA tz
 * database the runtime already carries.
 */
function isDigestWindow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '-1')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '-1')
  return hour === DIGEST_HOUR_IST && minute < DIGEST_WINDOW_MINUTES
}

interface PassLine {
  productName: string
  capacity: number
  confirmedCount: number
}

interface MunSection {
  munName: string
  newConfirmedLast24h: number
  passes: PassLine[]
}

function renderPassLine(pass: PassLine): string {
  const seatsLeft = Math.max(pass.capacity - pass.confirmedCount, 0)
  if (seatsLeft === 0) return `  - ${pass.productName}: SOLD OUT`
  return `  - ${pass.productName}: ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left (of ${pass.capacity})`
}

function renderDigestBody(organizerName: string, sections: MunSection[], appUrl: string): string {
  const munBlocks = sections
    .map((section) => {
      const passLines = section.passes.map(renderPassLine).join('\n')
      return (
        `"${section.munName}" — ${section.newConfirmedLast24h} new confirmed registration${section.newConfirmedLast24h === 1 ? '' : 's'} in the last 24h\n` +
        passLines
      )
    })
    .join('\n\n')

  return `Hi ${organizerName},\n\nHere's your daily MUN Hub digest:\n\n${munBlocks}\n\nView your dashboard: ${appUrl}/organizer/dashboard`
}

/**
 * Daily digest — one email per organizer with at least one REGISTRATION_OPEN
 * mun, summarizing new confirmed registrations in the last 24h and seats
 * left per registration product ("pass"), with a SOLD OUT callout once a
 * pass's confirmed count reaches its capacity. Fires once a day in a
 * 5-minute window at 09:00 IST (see `isDigestWindow`) — a no-op outside
 * that window, so this is safe to call every 5 minutes from a cron.
 *
 * "New confirmed in the last 24h" is approximated as `updatedAt >= now -
 * 24h AND status = 'CONFIRMED'` — registrations has no dedicated
 * `confirmedAt` column, and `updatedAt` is set exactly when the payment
 * webhook transitions a registration to CONFIRMED (lib/actions/
 * registration.ts). This slightly over-counts if some other write touches
 * an already-confirmed row within the window (e.g. an accommodation answer
 * edit), which never happens in the current registration flow, but is
 * documented here in case that changes.
 */
export async function runOrganizerDigest(
  now: Date,
  adapter: NotificationsAdapter = getNotificationsAdapter(),
): Promise<{ sent: number }> {
  if (!isDigestWindow(now)) return { sent: 0 }

  const openMuns = await db
    .select({ id: muns.id, name: muns.name, organizerId: muns.organizerId })
    .from(muns)
    .where(eq(muns.status, 'REGISTRATION_OPEN'))

  if (openMuns.length === 0) return { sent: 0 }

  const munIds = openMuns.map((mun) => mun.id)
  const since = new Date(now.getTime() - DAY_MS)

  const [products, confirmedRegistrations, newConfirmedRows, organizers] = await Promise.all([
    db
      .select({
        id: registrationProducts.id,
        munId: registrationProducts.munId,
        name: registrationProducts.name,
        capacity: registrationProducts.capacity,
      })
      .from(registrationProducts)
      .where(and(inArray(registrationProducts.munId, munIds), eq(registrationProducts.status, 'active'))),
    db
      .select({ registrationProductId: registrations.registrationProductId })
      .from(registrations)
      .where(and(inArray(registrations.munId, munIds), eq(registrations.status, 'CONFIRMED'))),
    db
      .select({ munId: registrations.munId })
      .from(registrations)
      .where(and(inArray(registrations.munId, munIds), eq(registrations.status, 'CONFIRMED'), gte(registrations.updatedAt, since))),
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, [...new Set(openMuns.map((mun) => mun.organizerId))])),
  ])

  const confirmedByProduct = new Map<string, number>()
  for (const row of confirmedRegistrations) {
    if (!row.registrationProductId) continue
    confirmedByProduct.set(row.registrationProductId, (confirmedByProduct.get(row.registrationProductId) ?? 0) + 1)
  }

  const newConfirmedByMun = new Map<string, number>()
  for (const row of newConfirmedRows) {
    newConfirmedByMun.set(row.munId, (newConfirmedByMun.get(row.munId) ?? 0) + 1)
  }

  const productsByMun = new Map<string, typeof products>()
  for (const product of products) {
    const list = productsByMun.get(product.munId) ?? []
    list.push(product)
    productsByMun.set(product.munId, list)
  }

  const organizerById = new Map(organizers.map((organizer) => [organizer.id, organizer]))
  const munsByOrganizer = new Map<string, typeof openMuns>()
  for (const mun of openMuns) {
    const list = munsByOrganizer.get(mun.organizerId) ?? []
    list.push(mun)
    munsByOrganizer.set(mun.organizerId, list)
  }

  const appUrl = getRuntimeEnv('APP_URL') ?? 'http://localhost:3000'
  let sent = 0

  await Promise.all(
    [...munsByOrganizer.entries()].map(async ([organizerId, organizerMuns]) => {
      const organizer = organizerById.get(organizerId)
      if (!organizer) return

      const sections: MunSection[] = organizerMuns.map((mun) => ({
        munName: mun.name,
        newConfirmedLast24h: newConfirmedByMun.get(mun.id) ?? 0,
        passes: (productsByMun.get(mun.id) ?? []).map((product) => ({
          productName: product.name,
          capacity: product.capacity,
          confirmedCount: confirmedByProduct.get(product.id) ?? 0,
        })),
      }))

      try {
        await adapter.send({
          to: organizer.email,
          subject: 'Your daily MUN Hub digest',
          body: renderDigestBody(organizer.name, sections, appUrl),
        })
        sent += 1
      } catch (error) {
        console.error('[organizer-digest-job] delivery failed', { organizerId, error })
      }
    }),
  )

  return { sent }
}
