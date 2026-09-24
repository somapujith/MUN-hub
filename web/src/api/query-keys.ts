export const queryKeys = {
  session: () => ["session"] as const,
  marketplaceFacets: () => ["marketplace", "facets"] as const,
  muns: (params: Record<string, unknown>) => ["muns", "search", params] as const,
  mun: (slug: string) => ["muns", "detail", slug] as const,
  munPreview: (munId: string) => ["organizer", "preview", munId] as const,
  // Public MUN page sections read by id (schedule, documents, faqs, ...).
  publicMunSection: (munId: string, section: string) =>
    ["muns", "public", munId, section] as const,
  dashboardUpcoming: () => ["dashboard", "upcoming"] as const,
  dashboardPast: () => ["dashboard", "past"] as const,
  credentials: () => ["dashboard", "credentials"] as const,
  userProfile: (userId: string) => ["user", "profile", userId] as const,
  registration: (id: string) => ["registration", id] as const,
  registrationReceipt: (id: string) => ["registration", id, "receipt"] as const,
  productAvailability: (productIds: string[]) =>
    ["registration", "availability", productIds] as const,
  // Public, non-sensitive additive platform fee rates — see
  // server/routes/registrations.ts's GET /registrations/fee-rates.
  feeRates: () => ["registration", "fee-rates"] as const,
  executiveBoard: (munId: string) => ["organizer", "executive-board", munId] as const,
  committees: (munId: string) => ["organizer", "committees", munId] as const,
  portfolios: (committeeId: string) => ["organizer", "portfolios", committeeId] as const,
  account: () => ["account"] as const,
  profileFormDefaults: () => ["profile", "form-defaults"] as const,
  accommodationOptions: (munId: string) => ["organizer", "accommodation", munId] as const,
  accommodationOptionFields: (optionId: string) =>
    ["organizer", "accommodation", "fields", optionId] as const,
  munAnalytics: (munId: string) => ["organizer", "analytics", munId] as const,
  certificates: (munId: string) => ["organizer", "certificates", munId] as const,
  munDocuments: (munId: string) => ["organizer", "documents", munId] as const,
  munMedia: (munId: string) => ["organizer", "media", munId] as const,
  paymentSettings: (munId: string) => ["organizer", "payment-settings", munId] as const,
  paymentsSummary: (munId: string) => ["organizer", "payments-summary", munId] as const,
  adminPaymentExceptions: (params: Record<string, unknown> = {}) => ["admin", "payment-exceptions", params] as const,
  adminPaymentExceptionsAll: () => ["admin", "payment-exceptions"] as const,
  adminRegistrations: (params: Record<string, unknown> = {}) => ["admin", "registrations", params] as const,
  adminRegistrationsAll: () => ["admin", "registrations"] as const,
  schedule: (munId: string) => ["organizer", "schedule", munId] as const,
  delegates: (munId: string, filters: Record<string, unknown>) =>
    ["organizer", "delegates", munId, filters] as const,
  formFields: (munId: string) => ["organizer", "form-fields", munId] as const,
  registrationProducts: (munId: string) => ["organizer", "registration-products", munId] as const,
  organizerWorkspace: () => ["organizer", "workspace", "overview"] as const,
  organizerOnboarding: () => ["organizer", "onboarding"] as const,
  organizerApplications: () => ["organizer", "applications"] as const,
  adminOrganizers: (params: Record<string, unknown>) => ["admin", "organizers", params] as const,
  munSetupDetails: (munId: string) => ["organizer", "setup", munId] as const,
  munContact: (munId: string) => ["organizer", "contact", munId] as const,
  munProgress: (munId: string) => ["organizer", "progress", munId] as const,
  munReviewFeedback: (munId: string) => ["organizer", "review-feedback", munId] as const,
  munConfirmationPreview: (munId: string) => ["organizer", "confirmation-preview", munId] as const,
  adminOverview: () => ["admin", "overview"] as const,
  adminAudit: (params: Record<string, unknown>) => ["admin", "audit", params] as const,
  adminAuditActors: () => ["admin", "audit", "actors"] as const,
  adminAuditHistory: (targetType: string, targetId: string) =>
    ["admin", "audit", "history", targetType, targetId] as const,
  // Gate 1 — organizer-application review (never the Gate 2 module queue below).
  adminReviewQueue: (params: Record<string, unknown>) => ["admin", "review-queue", params] as const,
  adminMunReview: (munId: string) => ["admin", "review-queue", "mun", munId] as const,
  // Gate 2 — module-level content-verification review (never the Gate 1 queue above).
  adminModuleReviewQueue: (params: Record<string, unknown>) =>
    ["admin", "module-review-queue", params] as const,
  // Support desk. The list and thread keys don't share a prefix, so
  // invalidating every list never refetches an open thread (and vice versa).
  adminSupportTickets: (params: Record<string, unknown>) => ["admin", "support-tickets", params] as const,
  myConversations: (params: Record<string, unknown> = {}) => ["support", "conversation-list", params] as const,
  conversation: (ticketId: string) => ["support", "conversation", ticketId] as const,
  unreadConversationCount: () => ["support", "unread-count"] as const,
  adminUnreadConversationCount: () => ["admin", "support", "unread-count"] as const,
  adminTelegramLink: () => ["admin", "support", "telegram"] as const,
  // Gate 2 publish queue (getGoLiveQueue) — never the organizer-facing
  // per-mun progress key (munProgress) above.
  adminGoLiveQueue: (params: Record<string, unknown>) => ["admin", "go-live-queue", params] as const,
  // Group/delegation registration (2026-09-17).
  groupRoster: (groupId: string) => ["registration-group", groupId] as const,
  groupInvitationPreview: (token: string) => ["registration-group", "invitation", token] as const,
};
