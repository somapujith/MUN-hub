// Seed scripts write demo accounts with a published password
// (`munhub-demo`, including an ADMIN) and fictional MUNs. Against any shared
// or production database that is an account-takeover hole, so seeding
// refuses to run unless DATABASE_URL points at this machine — or the operator
// explicitly opts in with ALLOW_REMOTE_SEED=true.
//
// Pure function over its inputs (no env reads) so it is trivially testable;
// callers pass `process.env` values. Seed scripts run under Node/tsx only,
// never on Workers.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isLocalHost(host: string): boolean {
  // A leading "/" is a Unix-domain socket directory on this machine.
  return LOCAL_HOSTS.has(host.toLowerCase()) || host.startsWith('/')
}

/**
 * Throws unless `databaseUrl` targets only local hosts (localhost,
 * 127.0.0.1, ::1 or a Unix socket), or `allowRemote` is true. Hosts given
 * through a `?host=` query parameter count too.
 */
export function assertSeedTargetIsLocal(databaseUrl: string | undefined, allowRemote: boolean): void {
  if (allowRemote) {
    console.warn('[seed] ALLOW_REMOTE_SEED=true — seeding a non-local database was explicitly allowed')
    return
  }

  if (!databaseUrl) {
    throw new Error('Refusing to seed: DATABASE_URL is not set')
  }

  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('Refusing to seed: DATABASE_URL is not a valid URL')
  }

  const hosts = [url.hostname, ...url.searchParams.getAll('host')]
    .flatMap((value) => value.split(','))
    .map((host) => decodeURIComponent(host).trim())
    .filter(Boolean)

  const remote = hosts.filter((host) => !isLocalHost(host))
  if (hosts.length === 0 || remote.length > 0) {
    throw new Error(
      `Refusing to seed: DATABASE_URL points at ${remote.length > 0 ? remote.join(', ') : 'no host'}, ` +
        'not this machine. Seed data includes demo accounts with a public password. ' +
        'Point DATABASE_URL at local Postgres (e.g. postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub), ' +
        'or set ALLOW_REMOTE_SEED=true if you really mean to seed that database.',
    )
  }
}

/** The guard as the seed scripts call it, reading this process's environment. */
export function assertSeedTargetIsLocalFromEnv(): void {
  assertSeedTargetIsLocal(process.env.DATABASE_URL, process.env.ALLOW_REMOTE_SEED === 'true')
}
