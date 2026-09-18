/**
 * One-off cleanup for local dev Postgres test-run pollution.
 *
 * `.env` and `.env.test` used to point at the same local Docker database, so
 * two days of Vitest runs wrote hundreds of thousands of junk `users`/`muns`
 * rows (test-fixture MUNs like "Reg Mun"/"Config Mun"/"Lifecycle Test Mun",
 * ~111k `deleted+<uuid>@deleted.invalid` soft-deleted test student accounts,
 * etc) into the same DB the dev server reads from. This script deletes all
 * of that, keeping only:
 *   - the fixed seed accounts (`%@munhub.test`, from lib/db/seed.ts) and the
 *     MUNs they organize (8 real seeded conferences),
 *   - the one MUN a human created by hand through the running app
 *     (`testing-mun-2027`, owned by somapujithkrishna07@gmail.com).
 *
 * Usage (through with-local-db.mjs, which pins DATABASE_URL to local Docker
 * before this script ever sees it -- but this script ALSO independently
 * refuses to run against anything but localhost/127.0.0.1/[::1] itself, the
 * same allowlist with-local-db.mjs uses, so a direct `npx tsx` invocation
 * that skips the wrapper -- e.g. from a shell that still has a Neon
 * DATABASE_URL exported from unrelated work -- fails closed instead of
 * silently deleting real production data):
 *
 *   node scripts/with-local-db.mjs npx tsx scripts/cleanup-dev-db-test-pollution.ts            (dry run, default)
 *   node scripts/with-local-db.mjs npx tsx scripts/cleanup-dev-db-test-pollution.ts --execute   (actually deletes)
 *
 * Design:
 *
 * 1. "Keep" = every user whose email matches `%@munhub.test` or equals
 *    somapujithkrishna07@gmail.com. Every `muns` row whose `organizer_id`
 *    is NOT one of those users is junk and gets removed. Everything under a
 *    junk mun cascades away automatically via each table's own `ON DELETE
 *    CASCADE` (committees, registration_products, mun_module_verifications,
 *    etc) -- Postgres handles that the moment the `muns` row itself is
 *    deleted, this script never touches those tables directly.
 *
 * 2. Anything with a `NO ACTION` (not `CASCADE`) foreign key into `muns.id`
 *    or `users.id` blocks the delete unless handled first. Rather than
 *    hand-maintaining a list of exactly which tables/columns those are (the
 *    schema changes over time and a stale hardcoded list is exactly the kind
 *    of bug that bites later), this script queries
 *    `information_schema` live, at the start of every run (dry run
 *    included), and walks that NO ACTION graph *transitively* -- e.g.
 *    `registrations.mun_id` is NO ACTION into `muns`, but `achievements`/
 *    `certificates`/`payments`/`registration_group_invitations` are in turn
 *    NO ACTION into `registrations`, so those have to be resolved first too,
 *    and so on. Nullable NO ACTION columns get NULLed (the referencing row
 *    is a real record that merely mentions a junk mun/user -- e.g. a support
 *    ticket's `related_mun_id`); NOT NULL ones get their row deleted (the
 *    row *is* junk without the thing it points at -- e.g. a registration
 *    without its mun). `planDeletions` below does this recursively and
 *    fails loudly (rather than guessing) if it ever finds a NOT NULL cycle
 *    it can't resolve by nulling one side.
 *
 * 3. Every mutation in `--execute` mode runs inside one `db.transaction`, so
 *    any surprise (a schema change introducing a new unresolvable
 *    constraint, for instance) rolls back cleanly instead of leaving a
 *    half-cleaned database.
 *
 * Known, accepted imprecision in the dry-run *counts* (not a safety issue,
 * just a reporting nuance -- it never affects what `--execute` actually
 * does, only what the preview prints). `reportPlan` excludes rows an
 * earlier op already claimed on the SAME table (e.g. a table deleted by
 * both a muns-pass op and a users-pass op), and a table that cascades
 * straight off `muns` gets a matching exclusion too (see `cascadeToMuns`
 * below) -- between the two, every table this script directly touches
 * reports an accurate, non-overlapping count. What is NOT re-propagated is
 * a third table's NULL op that references one of those already-partly-
 * pruned tables as ITS parent -- e.g. `support_tickets.related_registration_id`
 * is scoped by "the referenced registration belongs to a non-keep user",
 * which is evaluated against the live, not-yet-pruned `registrations` table,
 * so it can still count a support ticket whose referenced registration was
 * actually already removed by an earlier op. This can make that one kind of
 * line look larger than what `--execute` will actually find left to touch.
 * It is a display nicety only -- the counted rows are genuinely junk either
 * way, and `--execute` does not double-delete anything (a second DELETE/
 * UPDATE against an already-gone row just matches zero rows).
 */

import { parseArgs } from 'node:util'
import { eq, like, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { muns, users } from '@/lib/db/schema'

// The 9 real MUNs that must survive this cleanup. The 8 seeded ones come
// from lib/db/seed.ts's MUN_SEEDS; testing-mun-2027 is the one a human
// created by hand through the running app.
const EXPECTED_REAL_SLUGS = [
  'oxford-mun-2027',
  'vit-mun-2027',
  'bitsmun-hyderabad-25',
  'cbitmun-2026',
  'shri-hmun-2026',
  'vista-mun-2025',
  'st-francis-college-mun-2025',
  'm-un-2025',
  'testing-mun-2027',
] as const

const KEEP_EMAIL_LIKE = '%@munhub.test'
const KEEP_EXACT_EMAIL = 'somapujithkrishna07@gmail.com'

// Same allowlist and check as scripts/with-local-db.mjs. That wrapper is the
// normal way this script gets invoked, but this check does NOT rely on it --
// it runs independently so a direct invocation that skips the wrapper still
// fails closed instead of trusting whatever DATABASE_URL happens to already
// be in the shell.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

// ---------------------------------------------------------------------------
// information_schema helpers
// ---------------------------------------------------------------------------

interface FkRow {
  table_name: string
  column_name: string
  referenced_column: string
  delete_rule: string
}

/** Executor shape shared by `db` and a `tx` inside `db.transaction(...)`. */
interface Executor {
  execute: (query: SQL) => Promise<unknown>
}

async function rows<T>(exec: Executor, query: SQL): Promise<T[]> {
  return (await exec.execute(query)) as T[]
}

/** Live foreign keys pointing AT `referencedTable`, optionally filtered by delete_rule(s). */
async function fksReferencing(
  exec: Executor,
  referencedTable: string,
  deleteRule?: string | string[],
): Promise<FkRow[]> {
  const rules = deleteRule === undefined ? undefined : Array.isArray(deleteRule) ? deleteRule : [deleteRule]
  return rows<FkRow>(
    exec,
    sql`
      SELECT tc.table_name, kcu.column_name, ccu.column_name AS referenced_column, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name AND tc.constraint_schema = rc.constraint_schema
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND ccu.table_name = ${referencedTable}
        ${rules ? sql`AND rc.delete_rule IN (${sql.join(rules.map((r) => sql`${r}`), sql`, `)})` : sql``}
      ORDER BY tc.table_name, kcu.column_name
    `,
  )
}

async function isNullable(exec: Executor, table: string, column: string): Promise<boolean> {
  const result = await rows<{ is_nullable: string }>(
    exec,
    sql`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    `,
  )
  const found = result[0]
  if (!found) throw new Error(`column not found while checking nullability: ${table}.${column}`)
  return found.is_nullable === 'YES'
}

async function countRows(exec: Executor, table: string, where?: SQL): Promise<number> {
  const result = await rows<{ count: number }>(
    exec,
    sql`SELECT COUNT(*)::int AS count FROM ${sql.identifier(table)}${where ? sql` WHERE ${where}` : sql``}`,
  )
  return result[0]?.count ?? 0
}

// ---------------------------------------------------------------------------
// Deletion plan: a transitive walk of the live NO ACTION FK graph
// ---------------------------------------------------------------------------

interface PlanOp {
  kind: 'DELETE' | 'NULL'
  table: string
  column?: string // set for NULL ops
  where: SQL // identifies exactly the affected rows in `table`
  describe: string
}

/**
 * Appends the operations needed to safely remove `parentTable` rows matching
 * `parentWhere`: every table with a NOT NULL NO ACTION FK into `parentTable`
 * gets its matching rows deleted (recursing into THEIR dependents first);
 * every table with a nullable one gets that column NULLed instead (the row
 * survives). CASCADE relationships are left alone -- Postgres handles those
 * the moment the actual DELETE for `parentTable` runs.
 *
 * `skipTables` lets a second, later root walk avoid re-planning a subtree an
 * earlier root walk already owns in full (see the users-vs-muns note below
 * `buildPlan`). `path` detects a genuine unresolvable NOT NULL cycle instead
 * of recursing forever or silently mishandling it (none exist in this
 * schema as of writing: the one real cycle, `registrations` <->
 * `registration_groups`, is breakable because both FK columns involved
 * happen to be nullable).
 */
async function planDeletions(
  exec: Executor,
  ops: PlanOp[],
  parentTable: string,
  parentWhere: SQL,
  path: string[],
  skipTables: ReadonlySet<string>,
): Promise<void> {
  const refs = await fksReferencing(exec, parentTable, 'NO ACTION')
  for (const ref of refs) {
    if (skipTables.has(ref.table_name)) continue

    const nullable = await isNullable(exec, ref.table_name, ref.column_name)
    const childWhere = sql`${sql.identifier(ref.column_name)} IN (
      SELECT ${sql.identifier(ref.referenced_column)} FROM ${sql.identifier(parentTable)} WHERE ${parentWhere}
    )`

    if (nullable) {
      ops.push({
        kind: 'NULL',
        table: ref.table_name,
        column: ref.column_name,
        where: childWhere,
        describe: `UPDATE ${ref.table_name} SET ${ref.column_name} = NULL  -- was referencing a removed ${parentTable} row`,
      })
      continue
    }

    if (path.includes(ref.table_name)) {
      throw new Error(
        `Unresolvable NOT NULL circular foreign key while planning deletions: ` +
          `${[...path, ref.table_name].join(' -> ')}. Needs manual handling -- refusing to guess.`,
      )
    }
    await planDeletions(exec, ops, ref.table_name, childWhere, [...path, ref.table_name], skipTables)
    ops.push({
      kind: 'DELETE',
      table: ref.table_name,
      where: childWhere,
      describe: `DELETE FROM ${ref.table_name}  -- was referencing a removed ${parentTable} row`,
    })
  }
}

/**
 * Full plan: first every op needed to remove the junk `muns` rows (and
 * everything NO-ACTION-hanging off them, transitively), then every op
 * needed to remove the junk `users` rows the same way.
 *
 * The users walk skips `muns` itself: `muns.organizer_id` is a NOT NULL NO
 * ACTION FK into `users.id`, so a naive walk would try to re-plan the exact
 * same muns subtree a second time, nested inside the users pass. The muns
 * pass above already owns that in full and runs first, so by the time the
 * users pass would reach it, those muns rows (and their whole subtree) are
 * already gone.
 */
async function buildPlan(exec: Executor, munsWhere: SQL, usersWhere: SQL): Promise<{ munsPlan: PlanOp[]; usersPlan: PlanOp[] }> {
  const munsPlan: PlanOp[] = []
  await planDeletions(exec, munsPlan, 'muns', munsWhere, ['muns'], new Set())
  munsPlan.push({ kind: 'DELETE', table: 'muns', where: munsWhere, describe: 'DELETE FROM muns  -- organizer not in keep-list' })

  const usersPlan: PlanOp[] = []
  await planDeletions(exec, usersPlan, 'users', usersWhere, ['users'], new Set(['muns']))
  usersPlan.push({ kind: 'DELETE', table: 'users', where: usersWhere, describe: 'DELETE FROM users  -- not in keep-list' })

  return { munsPlan, usersPlan }
}

// ---------------------------------------------------------------------------
// Dry-run counting: pure SELECTs, sequenced so the numbers reflect what a
// real run of the SAME ops in order would actually touch (a row a prior
// DELETE op already claimed doesn't get double-counted by a later op on the
// same table -- see the support_tickets example: created_by/assigned_to/
// last_message_sender_id are 3 separate ops on the same table).
// ---------------------------------------------------------------------------

/**
 * Reports a plan's ops with counts, and returns the accumulated "rows
 * already claimed by an earlier DELETE on this table" map so a later call
 * (the users pass, run after the muns pass) can seed its own counting with
 * it -- a table that had rows removed earlier (`registrations`,
 * `achievements`, `payments`, ...) mustn't have those same already-gone
 * rows counted again against a later op on that same table.
 */
async function reportPlan(label: string, plan: PlanOp[], preExcluded?: Map<string, SQL[]>): Promise<Map<string, SQL[]>> {
  console.log(`${label}:`)
  const priorDeleteWhereByTable = new Map<string, SQL[]>(preExcluded ? [...preExcluded].map(([k, v]) => [k, [...v]]) : [])
  for (const op of plan) {
    const priorDeletes = priorDeleteWhereByTable.get(op.table)
    const effectiveWhere =
      priorDeletes && priorDeletes.length > 0
        ? sql`(${op.where}) AND NOT (${sql.join(priorDeletes.map((w) => sql`(${w})`), sql` OR `)})`
        : op.where
    const count = await countRows(db, op.table, effectiveWhere)
    console.log(`  - [${op.kind === 'DELETE' ? 'DELETE' : 'NULL  '}] ${op.describe} -> ${count} row${count === 1 ? '' : 's'}`)
    if (op.kind === 'DELETE') {
      priorDeleteWhereByTable.set(op.table, [...(priorDeleteWhereByTable.get(op.table) ?? []), op.where])
    }
  }
  return priorDeleteWhereByTable
}

function planTouchedTables(plan: PlanOp[]): string[] {
  return [...new Set(plan.map((op) => op.table))]
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({ options: { execute: { type: 'boolean', default: false } }, strict: true })
  const execute = values.execute === true

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set. Run this via: node scripts/with-local-db.mjs npx tsx scripts/cleanup-dev-db-test-pollution.ts')
    process.exit(1)
  }
  const parsedUrl = new URL(databaseUrl)
  if (!LOCAL_HOSTS.has(parsedUrl.hostname)) {
    console.error(
      `Refusing to run: DATABASE_URL points at "${parsedUrl.hostname}", not localhost/127.0.0.1/[::1]. ` +
        `This script only ever operates on a local dev database. If you're seeing this while using ` +
        `scripts/with-local-db.mjs, something is wrong with that wrapper -- do not work around this check.`,
    )
    process.exit(1)
  }

  console.log('='.repeat(78))
  console.log(`Mode: ${execute ? 'EXECUTE -- will commit deletes' : 'DRY RUN -- no changes will be made'}`)
  console.log(`Database: ${parsedUrl.hostname}:${parsedUrl.port || '5432'}${parsedUrl.pathname}`)
  console.log('='.repeat(78))
  console.log('')

  // --- Keep-list -----------------------------------------------------------

  const keepUsers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(or(like(users.email, KEEP_EMAIL_LIKE), eq(users.email, KEEP_EXACT_EMAIL)))

  if (keepUsers.length === 0) {
    throw new Error('Keep-list query matched zero users -- refusing to continue (this would delete every user in the database).')
  }

  console.log(`Keep-list: ${keepUsers.length} users (email LIKE '${KEEP_EMAIL_LIKE}' OR email = '${KEEP_EXACT_EMAIL}')`)
  for (const u of [...keepUsers].sort((a, b) => a.email.localeCompare(b.email))) {
    console.log(`  - ${u.email}`)
  }
  console.log('')

  const keepUserIds = keepUsers.map((u) => u.id)
  const keepIdList = sql.join(
    keepUserIds.map((id) => sql`${id}`),
    sql`, `,
  )
  const munsWhere = sql`organizer_id NOT IN (${keepIdList})`
  const usersWhere = sql`id NOT IN (${keepIdList})`

  // --- Muns to delete --------------------------------------------------------

  const munsToDelete = await db
    .select({ id: muns.id, name: muns.name, slug: muns.slug, organizerId: muns.organizerId })
    .from(muns)
    .where(sql`${muns.organizerId} NOT IN (${keepIdList})`)

  const deleteSlugSet = new Set(munsToDelete.map((m) => m.slug))
  const distinctNames = [...new Set(munsToDelete.map((m) => m.name))].sort((a, b) => a.localeCompare(b))

  console.log(`Muns to delete: ${munsToDelete.length}`)
  console.log(`Sample of up to 10 distinct names being deleted (${distinctNames.length} distinct total):`)
  for (const name of distinctNames.slice(0, 10)) console.log(`  - ${name}`)
  console.log('')

  console.log(`Expected real slugs (must all be KEPT, none in the delete set):`)
  const wronglyMarkedForDeletion: string[] = []
  for (const slug of EXPECTED_REAL_SLUGS) {
    const inDeleteSet = deleteSlugSet.has(slug)
    if (inDeleteSet) wronglyMarkedForDeletion.push(slug)
    console.log(`  - ${slug}: ${inDeleteSet ? 'DELETE (!!!)' : 'kept'}`)
  }
  console.log('')
  if (wronglyMarkedForDeletion.length > 0) {
    throw new Error(
      `SAFETY CHECK FAILED: these real muns are in the delete set and would be destroyed: ${wronglyMarkedForDeletion.join(', ')}. Aborting before planning any deletes.`,
    )
  }

  // --- Users to delete: a domain breakdown, so a single stray real account
  // hiding among ~100k+ junk rows has something to actually show up against.
  // A flat sample of individual emails would be nearly useless at this scale
  // (the junk is dominated by unique deleted+<uuid>@deleted.invalid rows) --
  // grouping by domain instead surfaces any domain that doesn't look like
  // known junk (deleted.invalid) or a keep-list pattern (munhub.test) at a
  // glance, which is exactly what a flat sample would bury.
  const usersByDomain = await rows<{ domain: string; count: number }>(
    db,
    sql`
      SELECT split_part(email, '@', 2) AS domain, COUNT(*)::int AS count
      FROM users
      WHERE ${usersWhere}
      GROUP BY domain
      ORDER BY count DESC
      LIMIT 15
    `,
  )
  console.log('Users to delete, by email domain (top 15 -- check for anything that is not obvious test/junk debris):')
  for (const d of usersByDomain) console.log(`  - ${d.domain || '(no @ in email)'}: ${d.count}`)
  console.log('')

  // --- Live FK introspection (printed every run, dry or not) ---------------

  const noActionToMuns = await fksReferencing(db, 'muns', 'NO ACTION')
  console.log('Live introspection -- NO ACTION foreign keys referencing muns.id:')
  for (const r of noActionToMuns) console.log(`  - ${r.table_name}.${r.column_name}`)
  console.log('')

  const cascadeToMuns = await fksReferencing(db, 'muns', 'CASCADE')
  console.log('Live introspection -- CASCADE foreign keys referencing muns.id (auto-deleted by Postgres, not handled explicitly by this script):')
  for (const r of cascadeToMuns) console.log(`  - ${r.table_name}.${r.column_name}`)
  console.log('')

  const setNullToMuns = await fksReferencing(db, 'muns', ['SET NULL', 'SET DEFAULT'])
  console.log('Live introspection -- SET NULL/SET DEFAULT foreign keys referencing muns.id (auto-handled by Postgres, not handled explicitly by this script -- safe as long as the column is nullable, which Postgres itself enforces at constraint-creation time for SET NULL):')
  for (const r of setNullToMuns) console.log(`  - ${r.table_name}.${r.column_name} (${r.delete_rule})`)
  if (setNullToMuns.length === 0) console.log('  (none)')
  console.log('')

  const noActionToUsers = await fksReferencing(db, 'users', 'NO ACTION')
  console.log('Live introspection -- NO ACTION foreign keys referencing users.id:')
  for (const r of noActionToUsers) {
    if (r.table_name === 'muns') {
      console.log(`  - ${r.table_name}.${r.column_name}  (handled by the muns pass above, not re-planned here)`)
      continue
    }
    const nullable = await isNullable(db, r.table_name, r.column_name)
    console.log(`  - ${r.table_name}.${r.column_name}  (nullable: ${nullable ? 'yes -> will be NULLed' : 'no -> row will be DELETEd'})`)
  }
  console.log('')

  const setNullToUsers = await fksReferencing(db, 'users', ['SET NULL', 'SET DEFAULT'])
  console.log('Live introspection -- SET NULL/SET DEFAULT foreign keys referencing users.id (auto-handled by Postgres, not handled explicitly by this script):')
  for (const r of setNullToUsers) console.log(`  - ${r.table_name}.${r.column_name} (${r.delete_rule})`)
  if (setNullToUsers.length === 0) console.log('  (none)')
  console.log('')

  // --- Build the full transitive plan and report it -------------------------

  const { munsPlan, usersPlan } = await buildPlan(db, munsWhere, usersWhere)

  console.log('-'.repeat(78))
  console.log('Full deletion plan (includes tables discovered transitively -- e.g. a')
  console.log('table that references `registrations`, which itself references `muns` --')
  console.log('not just the direct-reference lists printed above):')
  console.log('-'.repeat(78))
  const munsPassPriorDeletes = await reportPlan('Muns pass (runs first)', munsPlan)
  console.log('')

  // The users pass runs strictly after every muns-pass op above. Two classes
  // of rows are therefore already gone by the time it actually runs, and
  // must not be double-counted against it:
  //
  //  1. Anything a muns-pass op explicitly deleted (registrations,
  //     achievements, certificates, payments, registration_group_invitations,
  //     ...) -- carried forward directly from reportPlan's own return value,
  //     the same bookkeeping it already uses to stop a *later op in the same
  //     pass* from re-counting an earlier one on the same table.
  //  2. Anything that cascades straight off `muns` via `ON DELETE CASCADE`
  //     (mun_module_verifications, mun_payment_settings, mun_submissions,
  //     organizer_confirmations, registration_groups, verification_issues,
  //     verification_logs, ...) -- these never get an explicit op at all (see
  //     the CASCADE list printed above), so they need an exclusion added
  //     explicitly here instead of inheriting one from #1.
  //
  // Both are dry-run counting corrections only -- see the file header.
  const preExcludedForUsersPass = new Map<string, SQL[]>(munsPassPriorDeletes)
  for (const ref of cascadeToMuns) {
    const alreadyGoneViaMunsCascade = sql`${sql.identifier(ref.column_name)} IN (SELECT id FROM ${sql.identifier('muns')} WHERE ${munsWhere})`
    preExcludedForUsersPass.set(ref.table_name, [...(preExcludedForUsersPass.get(ref.table_name) ?? []), alreadyGoneViaMunsCascade])
  }
  await reportPlan('Users pass (runs second, after all muns-pass ops)', usersPlan, preExcludedForUsersPass)
  console.log('')

  // --- Before counts + touched-table summary --------------------------------

  const touchedTables = [...new Set([...planTouchedTables(munsPlan), ...planTouchedTables(usersPlan)])]
  const beforeCounts = new Map<string, number>()
  for (const table of touchedTables) beforeCounts.set(table, await countRows(db, table))

  console.log('-'.repeat(78))
  console.log(`Row counts before${execute ? '' : ' (dry run -- "after" is projected, not actually applied)'}:`)
  console.log('-'.repeat(78))
  console.log(`  users: ${beforeCounts.get('users')}`)
  console.log(`  muns:  ${beforeCounts.get('muns')}`)
  for (const table of touchedTables) {
    if (table === 'users' || table === 'muns') continue
    console.log(`  ${table}: ${beforeCounts.get(table)}`)
  }
  console.log('')

  if (!execute) {
    const usersToDeleteCount = await countRows(db, 'users', usersWhere)
    const usersAfter = beforeCounts.get('users')! - usersToDeleteCount
    const munsAfter = beforeCounts.get('muns')! - munsToDelete.length
    console.log('DRY RUN -- nothing was changed. Re-run with --execute to apply.')
    console.log(`  users would go from ${beforeCounts.get('users')} to ${usersAfter} (projected delete: ${usersToDeleteCount})`)
    console.log(`  muns would go from ${beforeCounts.get('muns')} to ${munsAfter} (projected delete: ${munsToDelete.length})`)
    return
  }

  // --- Execute: snapshot the 9 real slugs, then run every op in one tx -----

  const beforeSnapshot = await db
    .select({ slug: muns.slug, id: muns.id, organizerId: muns.organizerId })
    .from(muns)
    .where(sql`${muns.slug} IN (${sql.join(EXPECTED_REAL_SLUGS.map((s) => sql`${s}`), sql`, `)})`)
  const beforeBySlug = new Map(beforeSnapshot.map((m) => [m.slug, m]))
  for (const slug of EXPECTED_REAL_SLUGS) {
    if (!beforeBySlug.has(slug)) {
      throw new Error(`Pre-execute sanity check failed: expected real mun "${slug}" was not found before running anything.`)
    }
  }

  console.log('EXECUTE -- running the plan inside a single transaction...')
  await db.transaction(async (tx) => {
    for (const op of [...munsPlan, ...usersPlan]) {
      const statement =
        op.kind === 'DELETE'
          ? sql`DELETE FROM ${sql.identifier(op.table)} WHERE ${op.where}`
          : sql`UPDATE ${sql.identifier(op.table)} SET ${sql.identifier(op.column!)} = NULL WHERE ${op.where}`
      const result = (await tx.execute(statement)) as { count?: number }
      console.log(`  - ${op.describe} -> ${result.count ?? 0} row${(result.count ?? 0) === 1 ? '' : 's'}`)
    }
  })
  console.log('Transaction committed.')
  console.log('')

  // --- After counts + assertions --------------------------------------------

  console.log('Row counts after:')
  const afterUsers = await countRows(db, 'users')
  const afterMuns = await countRows(db, 'muns')
  console.log(`  users: ${afterUsers}`)
  console.log(`  muns:  ${afterMuns}`)
  for (const table of touchedTables) {
    if (table === 'users' || table === 'muns') continue
    console.log(`  ${table}: ${await countRows(db, table)}`)
  }
  console.log('')

  const afterSnapshot = await db
    .select({ slug: muns.slug, id: muns.id, organizerId: muns.organizerId })
    .from(muns)
    .where(sql`${muns.slug} IN (${sql.join(EXPECTED_REAL_SLUGS.map((s) => sql`${s}`), sql`, `)})`)
  const afterBySlug = new Map(afterSnapshot.map((m) => [m.slug, m]))

  for (const slug of EXPECTED_REAL_SLUGS) {
    const before = beforeBySlug.get(slug)!
    const after = afterBySlug.get(slug)
    if (!after) {
      throw new Error(`POST-EXECUTE SAFETY FAILURE: real mun "${slug}" (id ${before.id}) no longer exists after the cleanup.`)
    }
    if (after.id !== before.id) {
      throw new Error(`POST-EXECUTE SAFETY FAILURE: real mun "${slug}" has a different id after the cleanup (${before.id} -> ${after.id}).`)
    }
    if (after.organizerId !== before.organizerId) {
      throw new Error(
        `POST-EXECUTE SAFETY FAILURE: real mun "${slug}" (id ${after.id}) has a different organizerId after the cleanup (${before.organizerId} -> ${after.organizerId}).`,
      )
    }
  }
  console.log(`Verified: all ${EXPECTED_REAL_SLUGS.length} expected real muns still exist with unchanged organizerId.`)
}

main()
  .then(async () => {
    await db.$client.end()
  })
  .catch(async (error) => {
    console.error('')
    console.error('cleanup-dev-db-test-pollution failed:', error instanceof Error ? error.message : error)
    await db.$client.end()
    process.exit(1)
  })
