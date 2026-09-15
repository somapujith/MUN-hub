import type {
  OrganizerMunSummary,
  OrganizerWorkspaceTotals,
  WorkspaceMun,
} from "@/types/organizer";

const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(10, 0, 0, 0);
  return d;
};

export const MOCK_WORKSPACE_MUNS: WorkspaceMun[] = [
  {
    id: "mun-bitsmun",
    name: "BITSMUN Hyderabad '25",
    slug: "bitsmun-hyderabad-25",
    edition: "2025",
    status: "REGISTRATION_OPEN",
  },
  {
    id: "mun-cbit",
    name: "CBITMUN 2026",
    slug: "cbitmun-2026",
    edition: "2026",
    status: "ONBOARDING",
  },
];

export const MOCK_ORGANIZER_MUN_SUMMARIES: OrganizerMunSummary[] =
  MOCK_WORKSPACE_MUNS.map((mun, index) => ({
    ...mun,
    startDate: daysFromNow(21 + index * 14),
    endDate: daysFromNow(23 + index * 14),
    registrationCount: 48 - index * 12,
    confirmedCount: 40 - index * 10,
    capacity: 120,
  }));

export const MOCK_ORGANIZER_TOTALS: OrganizerWorkspaceTotals = {
  registrations: 60,
  confirmed: 50,
  pending: 10,
  capacity: 240,
  availableSeats: 180,
};

export function getMockWorkspaceMun(munId: string): WorkspaceMun | null {
  return MOCK_WORKSPACE_MUNS.find((mun) => mun.id === munId) ?? null;
}
