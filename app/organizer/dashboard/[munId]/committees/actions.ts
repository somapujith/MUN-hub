"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import {
  createCommittee,
  createPortfolio,
  deleteCommittee,
  deletePortfolio,
  listPortfolios,
  updateCommittee,
  updatePortfolio,
} from "@/lib/actions/mun-config";
import type { Portfolio } from "@/lib/types";

/**
 * Route-local wrappers around the frozen `lib/actions/mun-config` committee +
 * portfolio surface. Same contract as `app/admin/review/actions.ts`:
 *
 *   1. The lib actions THROW (`Forbidden`, `Mun not found`, `Committee not
 *      found`, `Portfolio not found`, plus raw Postgres errors on a constraint
 *      violation). A client component needs a discriminated result it can turn
 *      into a toast, not an unhandled server-action rejection that blanks the
 *      page with an error boundary.
 *   2. Every lib action takes `session: Session | null` explicitly — it does
 *      NOT read the cookie itself. Passing `await getSession()` here is the
 *      only place the actor is resolved, and it is resolved SERVER-SIDE. No
 *      caller can supply an identity.
 *   3. The workspace renders dynamically off the session cookie, so a mutation
 *      needs `revalidatePath` or the committee list lingers in the client
 *      router cache and the UI shows a stale row the DB no longer has.
 *
 * Authorization is deliberately NOT re-implemented here. `createCommittee`,
 * `updateCommittee`, `deleteCommittee`, `createPortfolio`, `updatePortfolio`
 * and `deletePortfolio` each call `assertOwnsOrAdmin` internally (walking
 * portfolio -> committee -> mun where needed), so the munId/committeeId/
 * portfolioId arriving from the client is checked against the session's
 * ownership before any write. A second check here would be a stale duplicate,
 * and — worse — would imply the lib layer could be called unguarded.
 *
 * `revalidateSection` takes the munId only to build the path. It cannot be
 * used to leak another organizer's data: the mutation that precedes it has
 * already thrown if the actor doesn't own that mun.
 */

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { data?: never } : { data: T }))
  | { ok: false; error: string };

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Forbidden") {
      return "You no longer have permission to edit this conference. Sign in again.";
    }
    if (error.message === "Mun not found") {
      return "This conference no longer exists. Reload the page.";
    }
    if (error.message === "Committee not found") {
      return "That committee was already deleted. Reload the page.";
    }
    if (error.message === "Portfolio not found") {
      return "That portfolio was already deleted. Reload the page.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

function revalidateSection(munId: string): void {
  revalidatePath(`/organizer/dashboard/${munId}/committees`);
}

// ---------------------------------------------------------------------------
// Committees
// ---------------------------------------------------------------------------

export interface CommitteeFormValues {
  name: string;
  capacity: number;
  agenda: string;
  description: string;
}

/**
 * `agenda` and `description` are optional columns. An empty textarea submits
 * `""`, and persisting an empty string instead of NULL makes "has no agenda"
 * two different states in the DB — normalise to `undefined` at the boundary.
 */
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function createCommitteeAction(
  munId: string,
  values: CommitteeFormValues,
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const session = await getSession();
    const committee = await createCommittee(
      {
        munId,
        name: values.name.trim(),
        capacity: values.capacity,
        agenda: optional(values.agenda),
        description: optional(values.description),
      },
      session,
    );
    revalidateSection(munId);
    return { ok: true, data: { id: committee.id, name: committee.name } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function updateCommitteeAction(
  munId: string,
  committeeId: string,
  values: CommitteeFormValues,
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const session = await getSession();
    // `agenda`/`description` are sent as `null`-equivalent empty strings rather
    // than omitted: on an EDIT, `undefined` would mean "leave as-is" to
    // Drizzle's `.set()`, so clearing a field would silently no-op. An empty
    // string is a real, storable "cleared" value.
    const committee = await updateCommittee(
      committeeId,
      {
        name: values.name.trim(),
        capacity: values.capacity,
        agenda: values.agenda.trim(),
        description: values.description.trim(),
      },
      session,
    );
    revalidateSection(munId);
    return { ok: true, data: { id: committee.id, name: committee.name } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function deleteCommitteeAction(
  munId: string,
  committeeId: string,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    await deleteCommittee(committeeId, session);
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Portfolios
// ---------------------------------------------------------------------------

export interface PortfolioFormValues {
  name: string;
  type: string;
  availability: number;
}

export async function createPortfolioAction(
  munId: string,
  committeeId: string,
  values: PortfolioFormValues,
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const session = await getSession();
    const portfolio = await createPortfolio(
      {
        committeeId,
        name: values.name.trim(),
        type: optional(values.type),
        availability: values.availability,
      },
      session,
    );
    revalidateSection(munId);
    return { ok: true, data: { id: portfolio.id, name: portfolio.name } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function updatePortfolioAction(
  munId: string,
  portfolioId: string,
  values: PortfolioFormValues,
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const session = await getSession();
    const portfolio = await updatePortfolio(
      portfolioId,
      {
        name: values.name.trim(),
        type: values.type.trim(),
        availability: values.availability,
      },
      session,
    );
    revalidateSection(munId);
    return { ok: true, data: { id: portfolio.id, name: portfolio.name } };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function deletePortfolioAction(
  munId: string,
  portfolioId: string,
): Promise<ActionResult> {
  try {
    const session = await getSession();
    await deletePortfolio(portfolioId, session);
    revalidateSection(munId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

/**
 * Portfolios are fetched per committee on the server render, but a committee
 * created client-side after that render has no portfolio list yet. Rather than
 * force a full-page reload for the empty case, the client can pull the (empty)
 * list for a freshly-created committee. `listPortfolios` is a public read with
 * no auth — but it is only reachable here for a committeeId, and returns
 * nothing sensitive beyond what the public MUN detail page already shows.
 */
export async function listPortfoliosAction(
  committeeId: string,
): Promise<ActionResult<Portfolio[]>> {
  try {
    const portfolios = await listPortfolios(committeeId);
    return { ok: true, data: portfolios };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}
