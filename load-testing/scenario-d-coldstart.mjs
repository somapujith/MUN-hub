#!/usr/bin/env node
/**
 * Scenario (d): cold-start-ish single-request latency baseline.
 *
 * Sequential (never concurrent) single requests to a handful of endpoint
 * types, several times each, to see typical single-request latency
 * separate from the concurrent-load numbers in scenarios a/c. This is a
 * SINGLE LOCAL NODE PROCESS, not a Cloudflare Worker — it cannot show
 * actual Workers cold-start behavior (isolate spin-up, Hyperdrive dial,
 * etc. — see CLAUDE.md's "Cloudflare Hyperdrive bridge" and "second
 * critical bug" sections). It only shows this one Node process/Postgres
 * connection pool's steady-state single-request latency.
 *
 * Usage: node load-testing/scenario-d-coldstart.mjs [baseUrl]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.argv[2] ?? 'http://localhost:3140'
const REPEATS = 5

const fixtures = JSON.parse(readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'))
const { munId: mixedMunId, productId: mixedProductId, poolSize: mixedPoolSize } = fixtures.mixed
const { poolSize: racePoolSize } = fixtures.race

// Mirror of scenario-c's reservation: the LAST 10 mixed-pool students are
// reserved for this script so the two never claim the same identity.
const MIXED_RESERVED_FOR_COLDSTART = 10
const coldStartStudents = fixtures.students.slice(
  racePoolSize + mixedPoolSize - MIXED_RESERVED_FOR_COLDSTART,
  racePoolSize + mixedPoolSize,
)

async function timedFetch(label, url, options) {
  const start = performance.now()
  const res = await fetch(url, options)
  await res.arrayBuffer().catch(() => null)
  const elapsedMs = performance.now() - start
  console.log(`[scenario-d] ${label}: ${res.status} in ${elapsedMs.toFixed(1)}ms`)
  return { label, status: res.status, ok: res.ok, elapsedMs }
}

async function main() {
  console.log(`[scenario-d] base=${BASE_URL}, ${REPEATS} sequential repeats per endpoint type`)

  const results = { publicList: [], publicDetail: [], authenticatedRead: [], authenticatedWrite: [] }

  for (let i = 0; i < REPEATS; i += 1) {
    results.publicList.push(await timedFetch('public list', `${BASE_URL}/api/v1/muns?limit=5`))
  }

  for (let i = 0; i < REPEATS; i += 1) {
    results.publicDetail.push(await timedFetch('public detail', `${BASE_URL}/api/v1/muns/bitsmun-hyderabad-25`))
  }

  const readerStudent = coldStartStudents[0]
  for (let i = 0; i < REPEATS; i += 1) {
    results.authenticatedRead.push(
      await timedFetch('authenticated read', `${BASE_URL}/api/v1/me/registrations/upcoming`, {
        headers: { Cookie: `mun_hub_session=${readerStudent.token}` },
      }),
    )
  }

  // A write can only succeed once per user/product, so this uses
  // REPEATS distinct reserved students, one registration attempt each,
  // rather than repeating with one identity.
  const writeStudents = coldStartStudents.slice(1, 1 + REPEATS)
  for (let i = 0; i < writeStudents.length; i += 1) {
    const student = writeStudents[i]
    results.authenticatedWrite.push(
      await timedFetch('authenticated write (registration)', `${BASE_URL}/api/v1/registrations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5240',
          Cookie: `mun_hub_session=${student.token}`,
          'Idempotency-Key': `loadtest-coldstart-${student.userId}`,
        },
        body: JSON.stringify({ munId: mixedMunId, registrationProductId: mixedProductId }),
      }),
    )
  }

  console.log('\n[scenario-d] summary (ms):')
  for (const [label, samples] of Object.entries(results)) {
    const times = samples.map((s) => s.elapsedMs)
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    console.log(`  ${label}: [${times.map((t) => t.toFixed(1)).join(', ')}] avg=${avg.toFixed(1)}ms`)
  }

  const outPath = path.join(__dirname, 'results-scenario-d.json')
  writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\n[scenario-d] wrote ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
