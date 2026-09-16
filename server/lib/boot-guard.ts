/**
 * Production boot guard — spec Section 4.7.
 *
 * Refuses to start when NODE_ENV=production and no real auth adapter is
 * configured. Mirrors lib/crypto/field-encryption.ts: a silently-weak mock
 * in production is worse than a crash.
 */
export function assertProductionAuthConfigured(): void {
  if (process.env.NODE_ENV !== 'production') return

  const adapter = process.env.AUTH_ADAPTER?.trim().toLowerCase()
  if (!adapter || adapter === 'mock') {
    throw new Error(
      'Refusing to start: NODE_ENV=production requires a real auth adapter. ' +
        'Set AUTH_ADAPTER to a non-mock provider before deploying. ' +
        'The mock adapter (lib/auth/mock-adapter.ts) is dev/demo-only and must not ' +
        'be publicly routable in production.',
    )
  }
}
