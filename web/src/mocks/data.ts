import type { MunDetail, MunSummary } from "@/types";

const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(10, 0, 0, 0);
  return d;
};

export const MOCK_CITIES = ["Hyderabad", "Vellore", "Oxford"] as const;
export const MOCK_COUNTRIES = ["India", "United Kingdom"] as const;

export const MOCK_MUN_SUMMARIES: MunSummary[] = [
  {
    id: "mun-bitsmun",
    name: "BITSMUN Hyderabad '25",
    slug: "bitsmun-hyderabad-25",
    city: "Hyderabad",
    country: "India",
    startDate: daysFromNow(21),
    endDate: daysFromNow(23),
    status: "REGISTRATION_OPEN",
    minPrice: 1500,
    coverImage: null,
    organizerName: "BITS Pilani Hyderabad",
  },
  {
    id: "mun-cbit",
    name: "CBITMUN 2026",
    slug: "cbitmun-2026",
    city: "Hyderabad",
    country: "India",
    startDate: daysFromNow(45),
    endDate: daysFromNow(47),
    status: "REGISTRATION_OPEN",
    minPrice: 1200,
    coverImage: null,
    organizerName: "CBIT Hyderabad",
  },
  {
    id: "mun-shri",
    name: "Shri HMUN 2026",
    slug: "shri-hmun-2026",
    city: "Hyderabad",
    country: "India",
    startDate: daysFromNow(60),
    endDate: daysFromNow(62),
    status: "PUBLISHED",
    minPrice: 1800,
    coverImage: null,
    organizerName: "Shri Ramakrishna",
  },
  {
    id: "mun-vista",
    name: "Vista MUN 2025",
    slug: "vista-mun-2025",
    city: "Hyderabad",
    country: "India",
    startDate: daysFromNow(14),
    endDate: daysFromNow(16),
    status: "REGISTRATION_OPEN",
    minPrice: 1000,
    coverImage: null,
    organizerName: "Vista",
  },
  {
    id: "mun-vit",
    name: "VIT MUN 2027",
    slug: "vit-mun-2027",
    city: "Vellore",
    country: "India",
    startDate: daysFromNow(120),
    endDate: daysFromNow(122),
    status: "PUBLISHED",
    minPrice: 2000,
    coverImage: null,
    organizerName: "VIT Vellore",
  },
  {
    id: "mun-oxford",
    name: "Oxford MUN 2027",
    slug: "oxford-mun-2027",
    city: "Oxford",
    country: "United Kingdom",
    startDate: daysFromNow(200),
    endDate: daysFromNow(203),
    status: "REGISTRATION_CLOSED",
    minPrice: 2500,
    coverImage: null,
    organizerName: "Oxford Union",
  },
];

function detailFromSummary(s: MunSummary, extra?: Partial<MunDetail>): MunDetail {
  const committeeId = `${s.id}-unsc`;
  return {
    id: s.id,
    organizerId: `org-${s.id}`,
    name: s.name,
    slug: s.slug,
    edition: "2025",
    theme: "Diplomacy in a Multipolar World",
    description:
      `${s.name} brings together student delegates for three days of debate,` +
      ` caucusing, and drafting. Committees span classic UN bodies and crisis cabinets.`,
    startDate: s.startDate,
    endDate: s.endDate,
    venue: "Main Campus Auditorium",
    city: s.city,
    country: s.country,
    status: s.status,
    organizerName: s.organizerName,
    committees: [
      {
        id: committeeId,
        munId: s.id,
        name: "United Nations Security Council",
        abbreviation: "UNSC",
        description: "Addressing threats to international peace and security.",
        capacity: 15,
        portfolios: [
          { id: `${committeeId}-usa`, committeeId, name: "United States", country: "USA", capacity: 1 },
          { id: `${committeeId}-chn`, committeeId, name: "China", country: "CHN", capacity: 1 },
          { id: `${committeeId}-ind`, committeeId, name: "India", country: "IND", capacity: 1 },
        ],
      },
      {
        id: `${s.id}-unhrc`,
        munId: s.id,
        name: "UN Human Rights Council",
        abbreviation: "UNHRC",
        description: "Promoting and protecting human rights worldwide.",
        capacity: 40,
        portfolios: [
          { id: `${s.id}-unhrc-bra`, committeeId: `${s.id}-unhrc`, name: "Brazil", country: "BRA", capacity: 1 },
          { id: `${s.id}-unhrc-zaf`, committeeId: `${s.id}-unhrc`, name: "South Africa", country: "ZAF", capacity: 1 },
        ],
      },
    ],
    registrationProducts: [
      {
        id: `${s.id}-delegate`,
        munId: s.id,
        name: "Delegate Pass",
        description: "Full conference access with committee allotment.",
        price: s.minPrice ?? 1500,
        capacity: 200,
        deadline: s.startDate ? new Date(s.startDate.getTime() - 7 * 24 * 60 * 60 * 1000) : null,
        isActive: true,
      },
      {
        id: `${s.id}-eb`,
        munId: s.id,
        name: "Executive Board",
        description: "Chair / Vice-Chair track.",
        price: (s.minPrice ?? 1500) + 500,
        capacity: 20,
        deadline: s.startDate ? new Date(s.startDate.getTime() - 14 * 24 * 60 * 60 * 1000) : null,
        isActive: true,
      },
    ],
    ...extra,
  };
}

export const MOCK_MUN_DETAILS: Record<string, MunDetail> = Object.fromEntries(
  MOCK_MUN_SUMMARIES.map((s) => [s.slug, detailFromSummary(s)]),
);

export function searchMockMuns(opts: {
  query?: string;
  city?: string;
  country?: string;
  status?: string[];
  minPrice?: number;
  maxPrice?: number;
  sortBy?: "date" | "price" | "newest";
  limit?: number;
  offset?: number;
}): { results: MunSummary[]; total: number } {
  let results = [...MOCK_MUN_SUMMARIES];

  if (opts.query) {
    const q = opts.query.toLowerCase();
    results = results.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.city?.toLowerCase().includes(q) ?? false),
    );
  }
  if (opts.city) results = results.filter((m) => m.city === opts.city);
  if (opts.country) results = results.filter((m) => m.country === opts.country);
  if (opts.status?.length)
    results = results.filter((m) => opts.status!.includes(m.status));
  if (opts.minPrice != null)
    results = results.filter((m) => m.minPrice != null && m.minPrice >= opts.minPrice!);
  if (opts.maxPrice != null)
    results = results.filter((m) => m.minPrice != null && m.minPrice <= opts.maxPrice!);

  if (opts.sortBy === "price") {
    results.sort((a, b) => (a.minPrice ?? 0) - (b.minPrice ?? 0));
  } else if (opts.sortBy === "newest") {
    results = [...results].reverse();
  } else {
    results.sort(
      (a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0),
    );
  }

  const total = results.length;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? results.length;
  return { results: results.slice(offset, offset + limit), total };
}

export function getMockMunBySlug(slug: string): MunDetail | null {
  return MOCK_MUN_DETAILS[slug] ?? null;
}
