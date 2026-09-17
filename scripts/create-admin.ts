import { parseArgs } from 'node:util'
import { config } from 'dotenv'

// Creates or promotes a SUPER_ADMIN by email and prints a one-time
// set-password link (valid 24 hours). The break-glass path for the very first
// staff account, or for recovering access when no super admin can sign in.
// Every later staff account is created from /admin/staff.
//
//   npx tsx scripts/create-admin.ts --email you@example.com [--name "Your Name"] [--app-url https://munhub.in]
//
// Database: DATABASE_URL from the environment, else from `.env` (repo tooling
// convention; dotenv never overrides a variable that is already set).
// `.env` points at production Neon, so this script refuses any non-local
// database unless ALLOW_REMOTE_ADMIN_BOOTSTRAP=true is set for that one run:
//
//   ALLOW_REMOTE_ADMIN_BOOTSTRAP=true npx tsx scripts/create-admin.ts --email ... --app-url https://munhub.in
//
// Link base: --app-url, else APP_URL, else http://localhost:5173 (local only —
// a remote run must name the public web origin explicitly).
config({ path: '.env' })

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function fail(message: string): never {
  console.error(`create-admin: ${message}`)
  process.exit(1)
}

function databaseHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname
  } catch {
    fail('DATABASE_URL is not a valid URL')
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'app-url': { type: 'string' },
    },
    strict: true,
  })

  const email = values.email?.trim()
  if (!email) fail('--email is required')

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) fail('DATABASE_URL is not set')

  const host = databaseHost(databaseUrl)
  const isLocal = LOCAL_HOSTS.has(host)
  if (!isLocal && process.env.ALLOW_REMOTE_ADMIN_BOOTSTRAP !== 'true') {
    fail(
      `refusing to write to non-local database host "${host}". ` +
        'Set ALLOW_REMOTE_ADMIN_BOOTSTRAP=true for this run if that is really what you want.',
    )
  }

  const appUrl = values['app-url'] ?? process.env.APP_URL ?? (isLocal ? 'http://localhost:5173' : undefined)
  if (!appUrl) fail('a remote run needs --app-url (or APP_URL) set to the public web origin')

  // Imported only now: lib/db/client reads DATABASE_URL when the first query runs.
  const { bootstrapSuperAdmin } = await import('@/lib/actions/admin-staff')
  const { db } = await import('@/lib/db/client')

  try {
    const result = await bootstrapSuperAdmin({ email, name: values.name }, appUrl)

    console.log(
      result.created
        ? `Created SUPER_ADMIN ${email}`
        : result.previousRole === 'SUPER_ADMIN'
          ? `${email} is already a SUPER_ADMIN; issued a new set-password link`
          : `Promoted ${email} to SUPER_ADMIN`,
    )
    console.log(`  user id:       ${result.userId}`)
    console.log(`  database host: ${host}${isLocal ? '' : ' (REMOTE)'}`)
    if (result.previousRole && result.previousRole !== 'SUPER_ADMIN') {
      console.log(`  previous role: ${result.previousRole}`)
    }
    if (result.previousRole === 'STUDENT' || result.previousRole === 'ORGANIZER') {
      console.warn('  warning: this was a delegate/organizer account; it is now a platform super admin.')
    }
    if (result.wasSuspended) {
      console.log('  the account was suspended and has been reinstated')
    }
    console.log('')
    console.log('Set-password link (single use, share only with the account owner):')
    console.log(`  ${result.setPasswordUrl}`)
    console.log(`  expires ${result.expiresAt.toISOString()}`)
    console.log('Any previously issued, unused reset links for this account no longer work.')
  } finally {
    await db.$client.end()
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
