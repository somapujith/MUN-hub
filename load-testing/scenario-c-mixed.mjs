#!/usr/bin/env node
/**
 * Scenario (c): mixed realistic load, sustained >=60s.
 *
 * WORKER_COUNT concurrent loops each repeatedly pick a weighted random
 * action for DURATION_SEC seconds:
 *   70% GET /api/v1/muns (marketplace search/list)
 *   15% GET /api/v1/muns/:slug (a real published mun's detail page)
 *   10% GET /api/v1/me/registrations/upcoming (authenticated dashboard read)
 *    5% POST /api/v1/registrations (a registration attempt, one distinct
 *       mixed-pool student per attempt against fixtures.mixed's
 *       high-capacity free product, capped at the pool size reserved for
 *       this scenario — see the index range comment below, which must stay
 *       in sync with setup.ts's pool layout)
 *
 * Reports overall throughput (req/s) and error rate, plus per-action-type
 * p50/p95/p99 latency, computed from raw samples (not autocannon).
 *
 * Usage: node load-testing/scenario-c-mixed.mjs [baseUrl]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.argv[2] ?? 'http://localhost:3140'
const SLUGS = ['bitsmun-hyderabad-25', 'cbitmun-2026', 'shri-hmun-2026', 'vista-mun-2025']
const WORKER_COUNT = 30
const DURATION_SEC = 65

const fixtures = JSON.parse(readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'))
const { munId: mixedMunId, productId: mixedProductId, poolSize: mixedPoolSize } = fixtures.mixed
const { poolSize: racePoolSize } = fixtures.race

// setup.ts lays students out as [0, racePoolSize) for scenario b, then
// [racePoolSize, racePoolSize + mixedPoolSize) for the mixed pool. Reserve
// the last 10 mixed-pool slots for scenario-d's cold-start test so the two
// scripts never race for the same user's one-registration-per-product slot.
const MIXED_RESERVED_FOR_COLDSTART = 10
const mixedStudents = fixtures.students.slice(racePoolSize, racePoolSize + mixedPoolSize - MIXED_RESERVED_FOR_COLDSTART)
const dashboardStudents = fixtures.students.slice(racePoolSize, racePoolSize + mixedPoolSize) // any mixed-pool session is fine for read-only dashboard calls

let registrationAttemptsIssued = 0
const registrationLock = { locked: false }

function pickAction() {
  const r = Math.random()
  if (r < 0.7) return 'list'
  if (r < 0.85) return 'detail'
  if (r < 0.95) return 'dashboard'
  return 'register'
}

async function timedFetch(url, options) {
  const start = performance.now()
  try {
    const res = await fetch(url, options)
    // Drain the body so keep-alive connections are reused fairly.
    await res.arrayBuffer().catch(() => null)
    return { ok: res.ok, status: res.status, elapsedMs: performance.now() - start }
  } catch (error) {
    return { ok: false, status: 0, elapsedMs: performance.now() - start, error: String(error) }
  }
}

async function doList() {
  const q = ['mun', 'hyderabad', 'india', ''][Math.floor(Math.random() * 4)]
  return timedFetch(`${BASE_URL}/api/v1/muns?query=${encodeURIComponent(q)}&limit=20`)
}

async function doDetail() {
  const slug = SLUGS[Math.floor(Math.random() * SLUGS.length)]
  return timedFetch(`${BASE_URL}/api/v1/muns/${slug}`)
}

async function doDashboard() {
  const student = dashboardStudents[Math.floor(Math.random() * dashboardStudents.length)]
  return timedFetch(`${BASE_URL}/api/v1/me/registrations/upcoming`, {
    headers: { Cookie: `mun_hub_session=${student.token}` },
  })
}

async function doRegister() {
  // Claim the next unused mixed-pool student synchronously (single-threaded
  // JS, no real race) so no two workers reuse the same identity.
  if (registrationAttemptsIssued >= mixedStudents.length) {
    return doList() // pool exhausted; fall back to a harmless read instead of generating "already registered" noise
  }
  const student = mixedStudents[registrationAttemptsIssued]
  registrationAttemptsIssued += 1

  return timedFetch(`${BASE_URL}/api/v1/registrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5240',
      Cookie: `mun_hub_session=${student.token}`,
      'Idempotency-Key': `loadtest-mixed-${student.userId}`,
    },
    body: JSON.stringify({ munId: mixedMunId, registrationProductId: mixedProductId }),
  })
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

async function main() {
  console.log(`[scenario-c] base=${BASE_URL} workers=${WORKER_COUNT} duration=${DURATION_SEC}s`)
  console.log(`[scenario-c] mixed pool available for registration attempts: ${mixedStudents.length}`)

  const samples = { list: [], detail: [], dashboard: [], register: [] }
  const errors = { list: 0, detail: 0, dashboard: 0, register: 0 }
  let totalRequests = 0

  const deadline = Date.now() + DURATION_SEC * 1000

  async function worker() {
    while (Date.now() < deadline) {
      const action = pickAction()
      let result
      if (action === 'list') result = await doList()
      else if (action === 'detail') result = await doDetail()
      else if (action === 'dashboard') result = await doDashboard()
      else result = await doRegister()

      totalRequests += 1
      samples[action].push(result.elapsedMs)
      if (!result.ok) errors[action] += 1
    }
  }

  const wallStart = performance.now()
  await Promise.all(Array.from({ length: WORKER_COUNT }, () => worker()))
  const wallElapsedSec = (performance.now() - wallStart) / 1000

  const totalErrors = Object.values(errors).reduce((a, b) => a + b, 0)
  const throughput = totalRequests / wallElapsedSec

  console.log(`\n[scenario-c] wall time: ${wallElapsedSec.toFixed(1)}s`)
  console.log(`[scenario-c] total requests: ${totalRequests}, errors: ${totalErrors} (${((totalErrors / totalRequests) * 100).toFixed(3)}%)`)
  console.log(`[scenario-c] overall throughput: ${throughput.toFixed(1)} req/s`)
  console.log(`[scenario-c] registration attempts issued: ${registrationAttemptsIssued}`)

  const perAction = {}
  for (const key of Object.keys(samples)) {
    const sorted = [...samples[key]].sort((a, b) => a - b)
    perAction[key] = {
      count: sorted.length,
      errors: errors[key],
      errorRatePct: sorted.length > 0 ? Number(((errors[key] / sorted.length) * 100).toFixed(3)) : 0,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    }
    console.log(
      `[scenario-c] ${key.padEnd(10)} n=${perAction[key].count.toString().padStart(6)} err=${perAction[key].errorRatePct}% p50=${perAction[key].p50?.toFixed(1)}ms p95=${perAction[key].p95?.toFixed(1)}ms p99=${perAction[key].p99?.toFixed(1)}ms`,
    )
  }

  const outPath = path.join(__dirname, 'results-scenario-c.json')
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        workerCount: WORKER_COUNT,
        durationSec: wallElapsedSec,
        totalRequests,
        totalErrors,
        errorRatePct: Number(((totalErrors / totalRequests) * 100).toFixed(3)),
        throughputReqPerSec: Number(throughput.toFixed(1)),
        registrationAttemptsIssued,
        perAction,
      },
      null,
      2,
    ),
  )
  console.log(`\n[scenario-c] wrote ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
