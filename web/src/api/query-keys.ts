export const queryKeys = {
  session: () => ["session"] as const,
  marketplaceFacets: () => ["marketplace", "facets"] as const,
  muns: (params: Record<string, unknown>) => ["muns", "search", params] as const,
  mun: (slug: string) => ["muns", "detail", slug] as const,
  dashboardUpcoming: () => ["dashboard", "upcoming"] as const,
  dashboardPast: () => ["dashboard", "past"] as const,
  userProfile: (userId: string) => ["user", "profile", userId] as const,
  registration: (id: string) => ["registration", id] as const,
  productAvailability: (productIds: string[]) =>
    ["registration", "availability", productIds] as const,
  executiveBoard: (munId: string) => ["organizer", "executive-board", munId] as const,
  committees: (munId: string) => ["organizer", "committees", munId] as const,
};
