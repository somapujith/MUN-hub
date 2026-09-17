/**
 * Deletes exactly the rows setup.ts created (by fixtures.json ids / the
 * LOADTEST_2026_09_17 tag), plus any registrations left behind against the
 * race/mixed muns by the scenario scripts. Never touches anything else in
 * local Docker Postgres.
 *
 * Run with: npx tsx load-testing/cleanup.ts
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, inArray, like } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { muns, payments, registrations, sessions, studentProfiles, users } from '../lib/db/schema'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesPath = path.join(__dirname, 'fixtures.json')

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? ''
  if (!dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1')) {
    throw new Error(`Refusing to run: DATABASE_URL does not look like local Docker Postgres (${dbUrl}).`)
  }

  if (!existsSync(fixturesPath)) {
    console.log('[cleanup] no fixtures.json found — nothing to do')
    return
  }

  const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8')) as {
    tag: string
    organizerId: string
    race: { munId: string }
    mixed: { munId: string }
    students: Array<{ userId: string }>
  }

  const munIds = [fixtures.race.munId, fixtures.mixed.munId]
  const studentUserIds = fixtures.students.map((s) => s.userId)
  const allUserIds = [fixtures.organizerId, ...studentUserIds]

  // Payments -> registrations -> student_profiles -> sessions -> muns (cascades
  // registration_products/committees/etc) -> users, in FK-safe order.
  const regRows = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(inArray(registrations.munId, munIds))
  const regIds = regRows.map((r) => r.id)
  if (regIds.length > 0) {
    await db.delete(payments).where(inArray(payments.registrationId, regIds))
    await db.delete(registrations).where(inArray(registrations.id, regIds))
  }

  await db.delete(studentProfiles).where(inArray(studentProfiles.userId, studentUserIds))
  await db.delete(sessions).where(inArray(sessions.userId, allUserIds))
  await db.delete(muns).where(inArray(muns.id, munIds))
  await db.delete(users).where(inArray(users.id, allUserIds))

  // Belt-and-braces: catch anything matching the tag by name/email that the
  // id-based deletes above might have missed (e.g. a re-run after a partial
  // failure created a second generation of rows).
  const strayMuns = await db.select({ id: muns.id }).from(muns).where(like(muns.name, `${fixtures.tag}%`))
  if (strayMuns.length > 0) {
    const strayIds = strayMuns.map((m) => m.id)
    const strayRegs = await db.select({ id: registrations.id }).from(registrations).where(inArray(registrations.munId, strayIds))
    if (strayRegs.length > 0) {
      await db.delete(payments).where(inArray(payments.registrationId, strayRegs.map((r) => r.id)))
      await db.delete(registrations).where(inArray(registrations.id, strayRegs.map((r) => r.id)))
    }
    await db.delete(muns).where(inArray(muns.id, strayIds))
  }
  const strayUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `${fixtures.tag.toLowerCase()}%`))
  if (strayUsers.length > 0) {
    const strayIds = strayUsers.map((u) => u.id)
    await db.delete(studentProfiles).where(inArray(studentProfiles.userId, strayIds))
    await db.delete(sessions).where(inArray(sessions.userId, strayIds))
    await db.delete(users).where(inArray(users.id, strayIds))
  }

  console.log(
    `[cleanup] removed ${regIds.length} registrations, ${munIds.length} muns, ${allUserIds.length} users (+ ${strayMuns.length} stray muns, ${strayUsers.length} stray users)`,
  )

  unlinkSync(fixturesPath)
  console.log('[cleanup] removed fixtures.json')

  await db.$client.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
