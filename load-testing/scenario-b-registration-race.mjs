#!/usr/bin/env node
/**
 * Scenario (b): registration capacity race — a load test AND a correctness
 * proof at once. Fires RACE_POOL_SIZE concurrent POST /api/v1/registrations
 * calls, one per distinct authenticated student (a single user can only
 * hold one active registration per product — see
 * lib/actions/registration.ts — so the race needs distinct identities, not
 * repeat calls from one session), all against the ONE registration product
 * fixtures.race created with fixtures.race.capacity seats.
 *
 * After the dust settles, queries local Docker Postgres directly to count
 * how many registrations against that product ended up in a
 * seat-holding status (PENDING/PAYMENT_PENDING/CONFIRMED — see
 * ACTIVE_REGISTRATION_STATUSES in lib/actions/registration.ts) and asserts
 * that count is exactly `capacity`, never more (an oversell) and never less
 * without explanation (a lost seat).
 *
 * Usage: node load-testing/scenario-b-registration-race.mjs [baseUrl]
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.argv[2] ?? 'http://localhost:3140'
const FIXTURE_KEY = process.argv[3] ?? 'race' // pass "race2" to re-run against the second (capacity-3) product

const fixtures = JSON.parse(readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'))
const { munId, productId, capacity, poolSize } = fixtures[FIXTURE_KEY]
const racers = fixtures.students.slice(0, poolSize)

if (racers.length !== poolSize) {
  throw new Error(`Expected ${poolSize} race students in fixtures.json, found ${racers.length}`)
}

async function attemptRegistration(student, index) {
  const start = performance.now()
  try {
    const res = await fetch(`${BASE_URL}/api/v1/registrations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5240', // trusted by ALLOW_LOCALHOST_ORIGINS=true — see server/lib/origins.ts
        Cookie: `mun_hub_session=${student.token}`,
        'Idempotency-Key': `loadtest-race-${FIXTURE_KEY}-${index}-${student.userId}`,
      },
      body: JSON.stringify({ munId, registrationProductId: productId }),
    })
    const body = await res.json().catch(() => null)
    const elapsedMs = performance.now() - start
    return { userId: student.userId, status: res.status, ok: res.ok, body, elapsedMs }
  } catch (error) {
    const elapsedMs = performance.now() - start
    return { userId: student.userId, status: 0, ok: false, error: String(error), elapsedMs }
  }
}

async function main() {
  console.log(`[scenario-b] base=${BASE_URL}`)
  console.log(`[scenario-b] mun=${munId} product=${productId} capacity=${capacity} racers=${racers.length}`)
  console.log('[scenario-b] firing all requests simultaneously...')

  const wallStart = performance.now()
  const outcomes = await Promise.all(racers.map((student, i) => attemptRegistration(student, i)))
  const wallElapsedMs = performance.now() - wallStart

  const succeeded = outcomes.filter((o) => o.ok)
  const capacityRejected = outcomes.filter(
    (o) => !o.ok && typeof o.body?.error?.message === 'string' && o.body.error.message.includes('at capacity'),
  )
  const otherFailed = outcomes.filter((o) => !o.ok && !capacityRejected.includes(o))

  console.log(`\n[scenario-b] wall time for all ${racers.length} concurrent calls: ${wallElapsedMs.toFixed(1)}ms`)
  console.log(`[scenario-b] HTTP 2xx (seat granted): ${succeeded.length}`)
  console.log(`[scenario-b] HTTP rejected "at capacity": ${capacityRejected.length}`)
  console.log(`[scenario-b] HTTP other failures: ${otherFailed.length}`)
  if (otherFailed.length > 0) {
    console.log('[scenario-b] other failures detail:', JSON.stringify(otherFailed, null, 2))
  }

  // Ground truth: query the DB directly, independent of what the HTTP layer
  // told each caller, using the same ACTIVE_REGISTRATION_STATUSES set
  // lib/actions/registration.ts uses for capacity counting.
  const { db } = await import('../lib/db/client.ts')
  const { registrations } = await import('../lib/db/schema.ts')
  const { and, eq, inArray } = await import('drizzle-orm')

  const ACTIVE_REGISTRATION_STATUSES = ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED', 'ATTENDED', 'NO_SHOW']

  const activeRows = await db
    .select({ id: registrations.id, userId: registrations.userId, status: registrations.status })
    .from(registrations)
    .where(and(eq(registrations.registrationProductId, productId), inArray(registrations.status, ACTIVE_REGISTRATION_STATUSES)))

  const allRows = await db
    .select({ id: registrations.id, userId: registrations.userId, status: registrations.status })
    .from(registrations)
    .where(eq(registrations.registrationProductId, productId))

  console.log(`\n[scenario-b] DB ground truth: ${activeRows.length} active (seat-holding) registrations for this product (capacity ${capacity})`)
  console.log(`[scenario-b] DB ground truth: ${allRows.length} total registration rows for this product`)
  console.log('[scenario-b] status breakdown:', JSON.stringify(
    allRows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {}),
    null,
    2,
  ))

  const distinctActiveUsers = new Set(activeRows.map((r) => r.userId))
  const oversold = activeRows.length > capacity
  const doubleBooked = distinctActiveUsers.size !== activeRows.length

  const verdict = {
    oversold,
    doubleBooked,
    activeCount: activeRows.length,
    capacity,
    httpSucceeded: succeeded.length,
    httpCapacityRejected: capacityRejected.length,
    httpOtherFailed: otherFailed.length,
    wallElapsedMs,
  }

  console.log(`\n[scenario-b] VERDICT: ${oversold ? 'OVERSOLD -- CRITICAL BUG' : 'NO OVERSELL'} / ${doubleBooked ? 'DOUBLE-BOOKED USER FOUND -- BUG' : 'no user double-booked'}`)

  const outPath = path.join(__dirname, `results-scenario-b${FIXTURE_KEY === 'race' ? '' : `-${FIXTURE_KEY}`}.json`)
  writeFileSync(outPath, JSON.stringify({ verdict, outcomes, dbRows: allRows }, null, 2))
  console.log(`[scenario-b] wrote ${outPath}`)

  await db.$client.end()

  if (oversold || doubleBooked) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
