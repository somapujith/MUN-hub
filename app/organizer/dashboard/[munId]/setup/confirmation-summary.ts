import "server-only";

import { listCommittees, listPortfolios, listRegistrationProducts } from "@/lib/actions/mun-config";
import type { Committee, Portfolio, RegistrationProduct } from "@/lib/types";
import { getMunSetup, type MunSetupRecord } from "./queries";

/**
 * Everything the Organizer Final Confirmation screen (PRD §14, Gate 3) shows
 * before the organizer signs off. This is a read-only summary assembled from
 * the same tables `submitFinalConfirmation` snapshots — the two must stay in
 * visual sync, but this file does not call that action, it only renders what
 * it's about to lock in.
 *
 * No ownership filter here, same rationale as `getMunSetup`: `[munId]/layout.tsx`
 * already resolved this id through an owner-scoped read before this ever runs.
 */
export interface ConfirmationSummary {
  mun: MunSetupRecord;
  committees: (Committee & { portfolios: Portfolio[] })[];
  products: RegistrationProduct[];
}

export async function getConfirmationSummary(munId: string): Promise<ConfirmationSummary | null> {
  const mun = await getMunSetup(munId);
  if (!mun) return null;

  const committeeRows = await listCommittees(munId);
  const committees = await Promise.all(
    committeeRows.map(async (committee) => ({
      ...committee,
      portfolios: await listPortfolios(committee.id),
    })),
  );

  const products = await listRegistrationProducts(munId);

  return { mun, committees, products };
}
