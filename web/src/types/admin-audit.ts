export interface AdminOverviewStats {
  pendingApplications: number;
  pendingModuleReviews: number;
  openSupportTickets: number;
  paymentExceptions: number;
  goLiveQueue: number;
  /** MUNs whose submitted conference results are waiting for MUNHub (RESULTS_UNDER_REVIEW). */
  resultsReview: number;
}

export interface AdminAuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: Date;
}

export interface AdminAuditListResult {
  results: AdminAuditEntry[];
  total: number;
}

export interface AuditHistoryEntry {
  action: string;
  actorId: string;
  reason: string | null;
  createdAt: Date;
}
