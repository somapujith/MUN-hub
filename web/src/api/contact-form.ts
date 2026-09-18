import type { RequesterCategory } from "@/types/support";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/v1";

export interface ContactFormInput {
  category: RequesterCategory;
  name: string;
  email: string;
  phone: string;
  message?: string;
  /** Honeypot — always left blank by a real visitor. See server/routes/contact.ts. */
  website?: string;
}

/** The public "Contact us" form. No session required — files a ticket in MUN Hub's admin queue. */
export async function submitContactForm(input: ContactFormInput): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/contact`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
}
