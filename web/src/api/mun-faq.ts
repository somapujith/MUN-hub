const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

/**
 * Organizer FAQ management — wraps server/routes/mun-faq.ts. The public read
 * the MUN page uses is `listPublicFaqs` in ./marketplace.ts. Limits mirror
 * lib/actions/mun-faq.ts (the server rejects longer text with a 400).
 */

export const FAQ_QUESTION_MAX_LENGTH = 300;
export const FAQ_ANSWER_MAX_LENGTH = 4000;

export interface MunFaq {
  id: string;
  munId: string;
  question: string;
  answer: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MunFaqInput {
  question: string;
  answer: string;
  displayOrder?: number;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Every FAQ of a MUN the caller owns, in any lifecycle state. */
export function listMunFaqsForOrganizer(munId: string) {
  return request<MunFaq[]>(`/muns/${encodeURIComponent(munId)}/faqs/manage`);
}

/** Appended after the existing FAQs unless `displayOrder` is given. */
export function createMunFaq(munId: string, input: MunFaqInput) {
  return request<MunFaq>(`/muns/${encodeURIComponent(munId)}/faqs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMunFaq(faqId: string, input: Partial<MunFaqInput>) {
  return request<MunFaq>(`/faqs/${encodeURIComponent(faqId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteMunFaq(faqId: string) {
  return request<void>(`/faqs/${encodeURIComponent(faqId)}`, { method: "DELETE" });
}
