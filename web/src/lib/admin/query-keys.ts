/**
 * Query keys for the admin console pages added after `@/api/query-keys` —
 * kept here so the shared key file doesn't need touching. Every key starts
 * with "admin", so invalidating ["admin"] still refreshes everything.
 */
export const adminQueryKeys = {
  muns: (params: Record<string, unknown>) => ["admin", "muns", "list", params] as const,
  munsAll: () => ["admin", "muns"] as const,
  mun: (munId: string) => ["admin", "muns", "detail", munId] as const,
  munPaymentSettings: (munId: string) => ["admin", "muns", "payment-settings", munId] as const,
  goLiveQueueDetails: (params: Record<string, unknown>) => ["admin", "go-live-queue", "details", params] as const,
  staff: (params: Record<string, unknown>) => ["admin", "staff", params] as const,
  staffAll: () => ["admin", "staff"] as const,
  analytics: () => ["admin", "analytics"] as const,
};
