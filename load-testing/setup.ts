/**
 * Load-test fixture setup — run once before the scenario scripts.
 *
 * Creates, under local Docker Postgres only (DATABASE_URL from .env.test):
 *   - one test organizer
 *   - one "race" MUN (REGISTRATION_OPEN) with a registration product of
 *     capacity RACE_CAPACITY, for the registration-race correctness scenario
 *   - one "mixed" MUN (REGISTRATION_OPEN) with a large-capacity product, for
 *     the mixed-load throughput scenario
 *   - STUDENT_POOL_SIZE student users, each with a complete student_profiles
 *     row (required before any registration) and a live session token, so
 *     the scenario scripts can drive the real HTTP API as real distinct
 *     delegates without going through signup/login for each one.
 *
 * All rows created here are tagged with a distinctive name prefix
 * (`LOADTEST_TAG`) and their ids are written to fixtures.json so
 * cleanup.ts can delete exactly these rows and nothing else.
 *
 * Run with: npx tsx load-testing/setup.ts
 * (DATABASE_URL must already point at local Docker Postgres — see README
 * note at the bottom of the load-testing report.)
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from '../lib/db/client'
import { muns, registrationProducts, sessions, studentProfiles, users } from '../lib/db/schema'
import { createSession } from '../lib/auth/session'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const LOADTEST_TAG = 'LOADTEST_2026_09_17'
const RACE_CAPACITY = 5
const RACE_POOL_SIZE = 20 // concurrent callers for the race scenario
const MIXED_POOL_SIZE = 120 // distinct users for the mixed-load scenario's registration slice
const STUDENT_POOL_SIZE = RACE_POOL_SIZE + MIXED_POOL_SIZE

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? ''
  if (!dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1')) {
    throw new Error(
      `Refusing to run: DATABASE_URL does not look like local Docker Postgres (${dbUrl}). ` +
        'This script must only ever run against .env.test / local Docker.',
    )
  }

  console.log(`[setup] DATABASE_URL host check passed (${dbUrl.split('@')[1] ?? dbUrl})`)

  const organizerId = crypto.randomUUID()
  await db.insert(users).values({
    id: organizerId,
    name: `${LOADTEST_TAG} Organizer`,
    email: `${LOADTEST_TAG.toLowerCase()}-organizer@example.test`,
    role: 'ORGANIZER',
  })

  const now = new Date()
  const raceMunId = crypto.randomUUID()
  await db.insert(muns).values({
    id: raceMunId,
    organizerId,
    name: `${LOADTEST_TAG} Race MUN`,
    slug: `${LOADTEST_TAG.toLowerCase()}-race-mun`,
    status: 'REGISTRATION_OPEN',
    startDate: new Date(now.getTime() + 30 * 86400_000),
    endDate: new Date(now.getTime() + 32 * 86400_000),
    registrationDeadline: new Date(now.getTime() + 20 * 86400_000),
    city: 'Hyderabad',
    country: 'India',
  })

  const raceProductId = crypto.randomUUID()
  await db.insert(registrationProducts).values({
    id: raceProductId,
    munId: raceMunId,
    name: `${LOADTEST_TAG} Race Pass`,
    price: 500, // paid pass, so the real payments/mock-adapter/fee path is exercised
    currency: 'INR',
    capacity: RACE_CAPACITY,
    status: 'active',
  })

  const mixedMunId = crypto.randomUUID()
  await db.insert(muns).values({
    id: mixedMunId,
    organizerId,
    name: `${LOADTEST_TAG} Mixed MUN`,
    slug: `${LOADTEST_TAG.toLowerCase()}-mixed-mun`,
    status: 'REGISTRATION_OPEN',
    startDate: new Date(now.getTime() + 30 * 86400_000),
    endDate: new Date(now.getTime() + 32 * 86400_000),
    registrationDeadline: new Date(now.getTime() + 20 * 86400_000),
    city: 'Hyderabad',
    country: 'India',
  })

  const mixedProductId = crypto.randomUUID()
  await db.insert(registrationProducts).values({
    id: mixedProductId,
    munId: mixedMunId,
    name: `${LOADTEST_TAG} Mixed Pass`,
    price: 0, // free pass -> CONFIRMED immediately, no mock-payment round trip needed for throughput noise
    currency: 'INR',
    capacity: 1_000_000,
    status: 'active',
  })

  console.log(`[setup] race mun ${raceMunId} / product ${raceProductId} (capacity ${RACE_CAPACITY})`)
  console.log(`[setup] mixed mun ${mixedMunId} / product ${mixedProductId} (capacity 1,000,000)`)

  const students: Array<{ userId: string; email: string; token: string }> = []
  const dob = new Date('2008-01-01T00:00:00.000Z')

  for (let i = 0; i < STUDENT_POOL_SIZE; i += 1) {
    const userId = crypto.randomUUID()
    const email = `${LOADTEST_TAG.toLowerCase()}-student-${i}@example.test`
    await db.insert(users).values({
      id: userId,
      name: `${LOADTEST_TAG} Student ${i}`,
      email,
      role: 'STUDENT',
      phone: '9999999999',
      institution: 'Load Test University',
    })
    await db.insert(studentProfiles).values({
      userId,
      dateOfBirth: dob,
      gradeOrYear: '12',
      residentialAddress: '123 Load Test Street',
      emergencyContactName: 'Load Test Contact',
      emergencyContactPhone: '9999999998',
      emergencyContactRelation: 'Parent',
    })
    const { token } = await createSession(userId)
    students.push({ userId, email, token })
  }

  console.log(`[setup] created ${students.length} student users+profiles+sessions`)

  const fixtures = {
    tag: LOADTEST_TAG,
    organizerId,
    race: { munId: raceMunId, productId: raceProductId, capacity: RACE_CAPACITY, poolSize: RACE_POOL_SIZE },
    mixed: { munId: mixedMunId, productId: mixedProductId, poolSize: MIXED_POOL_SIZE },
    students, // [0, RACE_POOL_SIZE) reserved for the race scenario; the rest for mixed/cold-start
  }

  writeFileSync(path.join(__dirname, 'fixtures.json'), JSON.stringify(fixtures, null, 2))
  console.log(`[setup] wrote ${path.join(__dirname, 'fixtures.json')}`)

  await db.$client.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
