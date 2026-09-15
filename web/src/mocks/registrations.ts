import { getMockMunBySlug } from "@/mocks/data";
import type { MockRegistrationDetail, RegistrationWithMun } from "@/types";

const minutesFromNow = (n: number) => new Date(Date.now() + n * 60 * 1000);
const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(10, 0, 0, 0);
  return d;
};
const daysAgo = (n: number) => daysFromNow(-n);

function munCard(slug: string) {
  const detail = getMockMunBySlug(slug);
  if (!detail) throw new Error(`Unknown mock mun slug: ${slug}`);
  return {
    id: detail.id,
    slug: detail.slug,
    name: detail.name,
    city: detail.city,
    country: detail.country,
    startDate: detail.startDate,
    endDate: detail.endDate,
  };
}

const INITIAL_UPCOMING: RegistrationWithMun[] = [
  {
    id: "reg-mock-confirmed-1",
    status: "CONFIRMED",
    registrationProductId: "mun-bitsmun-delegate",
    committeeId: "mun-bitsmun-unsc",
    portfolioId: "mun-bitsmun-unsc-ind",
    userId: "user-student-mock",
    expiresAt: null,
    mun: munCard("bitsmun-hyderabad-25"),
    committee: { name: "United Nations Security Council" },
    portfolio: { name: "India" },
    payment: [{ amount: 1500, status: "PAID" }],
  },
  {
    id: "reg-mock-pending-pay",
    status: "PAYMENT_PENDING",
    registrationProductId: "mun-vista-delegate",
    committeeId: null,
    portfolioId: null,
    userId: "user-student-mock",
    expiresAt: minutesFromNow(12),
    mun: munCard("vista-mun-2025"),
    committee: null,
    portfolio: null,
    payment: [{ amount: 1000, status: "PENDING" }],
  },
];

const INITIAL_PAST: RegistrationWithMun[] = [
  {
    id: "reg-mock-past-1",
    status: "ATTENDED",
    registrationProductId: "mun-vit-delegate",
    committeeId: "mun-vit-unhrc",
    portfolioId: "mun-vit-unhrc-bra",
    userId: "user-student-mock",
    expiresAt: null,
    mun: { ...munCard("vit-mun-2027"), startDate: daysAgo(90), endDate: daysAgo(88) },
    committee: { name: "UN Human Rights Council" },
    portfolio: { name: "Brazil" },
    payment: [{ amount: 2000, status: "PAID" }],
  },
];

let upcoming = [...INITIAL_UPCOMING];
let past = [...INITIAL_PAST];
const funnelById = new Map<string, MockRegistrationDetail>();

function toDetail(row: RegistrationWithMun): MockRegistrationDetail {
  const mun = getMockMunBySlug(row.mun.slug);
  const product =
    mun?.registrationProducts.find((p) => p.id === row.registrationProductId) ??
    mun?.registrationProducts[0];
  return {
    ...row,
    productName: product?.name ?? "Registration",
    productPrice: product?.price ?? 0,
  };
}

export async function fetchUpcomingRegistrations(): Promise<RegistrationWithMun[]> {
  await new Promise((r) => setTimeout(r, 120));
  const now = new Date();
  return upcoming.filter(
    (row) =>
      ["PENDING", "PAYMENT_PENDING", "CONFIRMED"].includes(row.status) &&
      row.mun.startDate !== null &&
      row.mun.startDate > now,
  );
}

export async function fetchPastRegistrations(): Promise<RegistrationWithMun[]> {
  await new Promise((r) => setTimeout(r, 120));
  const now = new Date();
  return past.filter(
    (row) =>
      row.status === "ATTENDED" ||
      row.status === "NO_SHOW" ||
      (row.mun.startDate !== null && row.mun.startDate < now),
  );
}

export async function fetchRegistrationById(id: string): Promise<MockRegistrationDetail | null> {
  await new Promise((r) => setTimeout(r, 60));
  const fromFunnel = funnelById.get(id);
  if (fromFunnel) return fromFunnel;
  const row = upcoming.find((r) => r.id === id) ?? past.find((r) => r.id === id);
  return row ? toDetail(row) : null;
}

export interface ProductAvailabilityEntry {
  productId: string;
  capacity: number;
  taken: number;
  available: number;
  deadlinePassed: boolean;
}

export async function fetchProductsAvailability(
  productIds: string[],
): Promise<ProductAvailabilityEntry[]> {
  await new Promise((r) => setTimeout(r, 40));
  return productIds.map((productId, i) => ({
    productId,
    capacity: 200,
    taken: 40 + i * 5,
    available: 160 - i * 5,
    deadlinePassed: false,
  }));
}

export async function mockInitiateRegistration(input: {
  slug: string;
  registrationProductId: string;
  committeeId?: string;
  portfolioId?: string;
}): Promise<{ registrationId: string }> {
  await new Promise((r) => setTimeout(r, 200));
  const mun = getMockMunBySlug(input.slug);
  if (!mun) throw new Error("MUN not found");
  const product = mun.registrationProducts.find((p) => p.id === input.registrationProductId);
  if (!product) throw new Error("Product not found");
  const committee = mun.committees.find((c) => c.id === input.committeeId);
  const portfolio = committee?.portfolios.find((p) => p.id === input.portfolioId);
  const id = `reg-mock-${Date.now()}`;
  const row: RegistrationWithMun = {
    id,
    status: "PAYMENT_PENDING",
    registrationProductId: product.id,
    committeeId: committee?.id ?? null,
    portfolioId: portfolio?.id ?? null,
    userId: "user-student-mock",
    expiresAt: minutesFromNow(15),
    mun: {
      id: mun.id,
      slug: mun.slug,
      name: mun.name,
      city: mun.city,
      country: mun.country,
      startDate: mun.startDate,
      endDate: mun.endDate,
    },
    committee: committee ? { name: committee.name } : null,
    portfolio: portfolio ? { name: portfolio.name } : null,
    payment: [{ amount: product.price, status: "PENDING" }],
  };
  const detail = toDetail(row);
  upcoming = [row, ...upcoming];
  funnelById.set(id, detail);
  return { registrationId: id };
}

export async function mockCompletePayment(
  registrationId: string,
  outcome: "success" | "failure",
): Promise<void> {
  await new Promise((r) => setTimeout(r, 250));
  const detail = funnelById.get(registrationId) ?? (await fetchRegistrationById(registrationId));
  if (!detail) return;
  const nextStatus = outcome === "success" ? "CONFIRMED" : "CANCELLED";
  const nextPayment = outcome === "success" ? "PAID" : "FAILED";
  const updated: MockRegistrationDetail = {
    ...detail,
    status: nextStatus,
    expiresAt: null,
    payment: [{ amount: detail.productPrice, status: nextPayment }],
  };
  upcoming = upcoming.map((r) => (r.id === registrationId ? { ...r, ...updated } : r));
  funnelById.set(registrationId, updated);
}
