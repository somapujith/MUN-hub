import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { muns } from "@/lib/db/schema";
import type { MunStatus } from "@/lib/db/schema-enums";
import { listMunMedia } from "@/lib/actions/mun-branding";
import { listMunDocuments } from "@/lib/actions/mun-documents";
import { listScheduleItems } from "@/lib/actions/mun-schedule";
import { getMunContact } from "@/lib/actions/mun-contact";
import { listMunFaqs } from "@/lib/actions/mun-faq";

/**
 * The editable field set for the MUN Setup module.
 *
 * Neither existing read covers this: `getWorkspaceMun` (../../workspace-queries.ts)
 * returns only what the shell chrome needs (id/name/slug/edition/status), and
 * `getOrganizerDashboard` (../../queries.ts) is a list aggregate. This page
 * needs every column `updateMunDetails` can write, so it can seed the forms
 * with current values.
 *
 * NO OWNERSHIP FILTER, DELIBERATELY. `[munId]/layout.tsx` has already resolved
 * this same id through `getWorkspaceMun`, which 404s an id the actor doesn't
 * own, so by the time this runs the actor is known to have read access.
 * Re-deriving the session here to filter again would be a second round trip
 * that changes no outcome. The mutation path is where it matters, and there
 * `assertOwnsOrAdmin` inside `lib/actions/mun-config.ts` re-checks on every
 * call — a layout gate is not a security boundary, because layouts don't
 * re-run on client navigation between sibling routes.
 */

export interface MunSetupRecord {
  id: string;
  name: string;
  edition: string | null;
  theme: string | null;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  status: MunStatus;
}

export async function getMunSetup(munId: string): Promise<MunSetupRecord | null> {
  const [mun] = await db
    .select({
      id: muns.id,
      name: muns.name,
      edition: muns.edition,
      theme: muns.theme,
      description: muns.description,
      startDate: muns.startDate,
      endDate: muns.endDate,
      venue: muns.venue,
      city: muns.city,
      country: muns.country,
      status: muns.status,
    })
    .from(muns)
    .where(eq(muns.id, munId))
    .limit(1);

  return mun ?? null;
}

export async function getMunSetupModules(munId: string) {
  const [media, documents, scheduleItems, contact, faqs] = await Promise.all([
    listMunMedia(munId),
    listMunDocuments(munId),
    listScheduleItems(munId),
    getMunContact(munId),
    listMunFaqs(munId),
  ]);
  return { media, documents, scheduleItems, contact, faqs };
}
