#!/usr/bin/env node
/**
 * Scenario (a): read-heavy marketplace browsing.
 *
 * Runs `npx autocannon` (no locally installed dependency — see CLAUDE.md
 * instructions this script was written under) against:
 *   - GET /api/v1/muns?query=mun&limit=20   (search/list)
 *   - GET /api/v1/muns/:slug                (detail, a real published slug)
 *
 * at increasing concurrency (10, 50, 100), each for 10s, and prints +
 * writes a JSON summary of p50/p97.5/p99 latency and error rate per level.
 *
 * Usage: node load-testing/scenario-a-browse.mjs [baseUrl] [slug]
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.argv[2] ?? 'http://localhost:3140'
const SLUG = process.argv[3] ?? 'bitsmun-hyderabad-25'
// "mun" was tried first and rejected as the default: on this local DB (heavy
// with accumulated autonomous-test-run data), ~97% of mun names contain
// "mun" as a substring, so it isn't a realistic search term — no index can
// speed up a predicate that matches almost every row, and Postgres correctly
// chooses a sequential scan for it either way. "hyderabad" (a city search)
// matches a more realistic ~20% of rows.
const QUERY_TERM = process.argv[4] ?? 'hyderabad'
const CONCURRENCY_LEVELS = [10, 50, 100]
const DURATION_SEC = 10

function runAutocannon(url, connections, duration) {
  // Deliberately never pass a URL containing "&" here: shell:true (required
  // on Windows, since npx.cmd is a batch script and plain execFileSync
  // spawning of it fails with EINVAL) routes through cmd.exe, which treats
  // an unquoted "&" as a command separator even when the whole command line
  // is wrapped in one outer quote pair by Node — every quoting workaround
  // tried here still broke on Windows. Callers keep each URL to a single
  // query param instead.
  if (url.includes('&')) {
    throw new Error(`runAutocannon: URL must not contain "&" (Windows cmd.exe shell quoting) — got ${url}`)
  }
  const isWin = process.platform === 'win32'
  const args = ['autocannon', '-c', String(connections), '-d', String(duration), '-j', url]
  const stdout = execFileSync('npx', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: isWin,
  })
  // -j prints one JSON object per sample tick plus a final full-run summary;
  // the summary is the only object with a `latency` key at the top level in
  // every run we've observed, and it's always last.
  const lines = stdout.trim().split('\n').filter(Boolean)
  const parsed = lines.map((line) => JSON.parse(line))
  return parsed[parsed.length - 1]
}

function summarize(result) {
  const total2xx = result['2xx'] ?? 0
  const totalReqs = result.requests?.total ?? 0
  const nonOk = totalReqs - total2xx
  return {
    connections: result.connections,
    durationSec: result.duration,
    totalRequests: totalReqs,
    '2xx': total2xx,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    errorRatePct: totalReqs > 0 ? Number(((nonOk / totalReqs) * 100).toFixed(3)) : 0,
    throughputReqPerSec: result.requests?.average ?? null,
    latencyMs: {
      p50: result.latency?.p50 ?? null,
      p97_5: result.latency?.p97_5 ?? null,
      p99: result.latency?.p99 ?? null,
      max: result.latency?.max ?? null,
    },
  }
}

async function main() {
  const listUrl = `${BASE_URL}/api/v1/muns?query=${QUERY_TERM}` // default page size (20) covers the "limit" case without a second query param — see runAutocannon's "&" note
  const detailUrl = `${BASE_URL}/api/v1/muns/${SLUG}`

  console.log(`[scenario-a] base=${BASE_URL} slug=${SLUG}`)
  console.log(`[scenario-a] list url: ${listUrl}`)
  console.log(`[scenario-a] detail url: ${detailUrl}`)

  const results = { list: [], detail: [] }

  for (const c of CONCURRENCY_LEVELS) {
    console.log(`\n--- concurrency ${c} ---`)

    console.log(`[list] running (${DURATION_SEC}s)...`)
    const listRaw = runAutocannon(listUrl, c, DURATION_SEC)
    const list = summarize(listRaw)
    results.list.push(list)
    console.log(
      `[list] c=${c} p50=${list.latencyMs.p50}ms p97.5=${list.latencyMs.p97_5}ms p99=${list.latencyMs.p99}ms err=${list.errorRatePct}% throughput=${list.throughputReqPerSec}req/s`,
    )

    console.log(`[detail] running (${DURATION_SEC}s)...`)
    const detailRaw = runAutocannon(detailUrl, c, DURATION_SEC)
    const detail = summarize(detailRaw)
    results.detail.push(detail)
    console.log(
      `[detail] c=${c} p50=${detail.latencyMs.p50}ms p97.5=${detail.latencyMs.p97_5}ms p99=${detail.latencyMs.p99}ms err=${detail.errorRatePct}% throughput=${detail.throughputReqPerSec}req/s`,
    )
  }

  const outPath = path.join(__dirname, 'results-scenario-a.json')
  writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\n[scenario-a] wrote ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
