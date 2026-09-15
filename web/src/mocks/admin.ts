import type { AdminQueueCard, GoLiveQueueResult } from "@/types/admin";

const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(17, 0, 0, 0);
  return d;
};

export const MOCK_ADMIN_OVERVIEW_CARDS: AdminQueueCard[] = [
  { label: "Pending Applications", value: 3, href: "/admin/review" },
  { label: "Pending Module Reviews", value: 7, href: "/admin/verification" },
  { label: "Open Support Tickets", value: 2, href: "/admin/support" },
  { label: "Payment Exceptions", value: 1, href: "/admin/payments" },
];

export const MOCK_GO_LIVE_QUEUE: GoLiveQueueResult = {
  total: 2,
  results: [
    {
      munId: "mun-shri",
      munName: "Shri HMUN 2026",
      munStatus: "GO_LIVE_QUEUE",
      submissionId: "sub-001",
      submissionStatus: "APPROVED",
      submittedAt: daysFromNow(-2),
      slaDeadline: daysFromNow(1),
      slaState: "ON_TRACK",
      queuedAt: daysFromNow(-1),
    },
    {
      munId: "mun-vista",
      munName: "Vista MUN 2025",
      munStatus: "GO_LIVE_QUEUE",
      submissionId: "sub-002",
      submissionStatus: "APPROVED",
      submittedAt: daysFromNow(-4),
      slaDeadline: daysFromNow(-1),
      slaState: "DELAYED",
      queuedAt: daysFromNow(-3),
    },
  ],
};

export const MOCK_REVIEW_QUEUE = {
  total: 3,
  results: [
    { id: "app-1", name: "Hyderabad Model UN Society", status: "SUBMITTED" as const },
    { id: "app-2", name: "Campus Diplomacy Club", status: "UNDER_REVIEW" as const },
    { id: "app-3", name: "Youth Parliament Vellore", status: "SUBMITTED" as const },
  ],
};

export const MOCK_VERIFICATION_QUEUE = {
  total: 7,
  results: [
    { munId: "mun-cbit", munName: "CBITMUN 2026", moduleName: "MUN_DETAILS" },
    { munId: "mun-cbit", munName: "CBITMUN 2026", moduleName: "COMMITTEES" },
  ],
};

export const MOCK_SUPPORT_TICKETS = [
  { id: "tkt-1", subject: "Payment not reflecting", status: "NEW" },
  { id: "tkt-2", subject: "Cannot upload logo", status: "NEW" },
];

export const MOCK_PAYMENT_EXCEPTIONS = [
  { id: "pay-1", registrationId: "reg-99", reason: "Webhook timeout" },
];

export const MOCK_REGISTRATIONS = {
  total: 42,
  results: [
    { id: "reg-1", delegateName: "A. Sharma", munName: "BITSMUN Hyderabad '25", status: "CONFIRMED" },
    { id: "reg-2", delegateName: "R. Patel", munName: "CBITMUN 2026", status: "PAYMENT_PENDING" },
  ],
};

export const MOCK_AUDIT_ENTRIES = [
  { id: "aud-1", action: "reviewMunApplication", targetType: "mun", targetId: "app-1", at: daysFromNow(-1) },
  { id: "aud-2", action: "reviewModule", targetType: "mun", targetId: "mun-cbit", at: daysFromNow(-2) },
];
