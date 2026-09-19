import type { MyAchievement, MyCertificate, MyCredentials } from "@/types/credentials";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

/** Wire shape: the same rows with every date as an ISO string (JSON has no Date type). */
interface RawCredentials {
  achievements: Array<
    Omit<MyAchievement, "munStartDate" | "munEndDate" | "awardedAt"> & {
      munStartDate: string | null;
      munEndDate: string | null;
      awardedAt: string;
    }
  >;
  certificates: Array<
    Omit<MyCertificate, "munStartDate" | "munEndDate" | "issuedAt"> & {
      munStartDate: string | null;
      munEndDate: string | null;
      issuedAt: string;
    }
  >;
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

/** The signed-in delegate's verified awards and certificates (GET /me/credentials). */
export async function fetchMyCredentials(): Promise<MyCredentials> {
  const response = await fetch(`${API_BASE_URL}/me/credentials`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  const raw = (await response.json()) as RawCredentials;
  return {
    achievements: raw.achievements.map((row) => ({
      ...row,
      munStartDate: toDate(row.munStartDate),
      munEndDate: toDate(row.munEndDate),
      awardedAt: new Date(row.awardedAt),
    })),
    certificates: raw.certificates.map((row) => ({
      ...row,
      munStartDate: toDate(row.munStartDate),
      munEndDate: toDate(row.munEndDate),
      issuedAt: new Date(row.issuedAt),
    })),
  };
}
