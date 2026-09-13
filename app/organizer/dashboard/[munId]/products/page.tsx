import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import { requireOrganizerActor } from "../../auth";
import { getProductsForMun } from "./queries";
import { AddProductButton, ProductTable } from "./product-table";

/**
 * Registration Products (PRD § 15).
 *
 * Reads via the page-local `./queries.ts` rather than a `lib/actions` call —
 * see the long note at the top of that file: the frozen contract has
 * create/update/delete for registration products but no list function, and the
 * one read that returns product rows (`getMunBySlug`) filters to
 * `status = 'active'`, which structurally cannot show a soft-deleted product.
 *
 * Auth: `../../layout.tsx` already gated this route and 404s a mun the actor
 * doesn't own, so this page adds no gate of its own. `requireOrganizerActor`
 * is called only to obtain the actor for the ownership-scoped read — it is
 * `cache()`d, so this shares the layout's single session round trip rather
 * than adding one. `getProductsForMun` still re-checks ownership itself; a
 * layout is chrome, not a security boundary.
 *
 * PRD § 15 lists eligibility, benefits, description, currency and a
 * registration start/end window as product fields. Only name, price, currency,
 * capacity, deadline and status exist on `registrationProducts` today and only
 * those are accepted by `CreateRegistrationProductInput`, so the form covers
 * exactly those. The remaining fields need a schema migration on the backend
 * side before any UI can carry them.
 */

export const metadata: Metadata = { title: "Registration Products" };

export default async function ProductsPage({
  params,
}: PageProps<"/organizer/dashboard/[munId]/products">) {
  const { munId } = await params;
  const actor = await requireOrganizerActor();

  const data = await getProductsForMun(munId, actor.userId, actor.role);
  if (!data) notFound();

  return (
    <WorkspacePage
      title="Registration products"
      description="Delegate, press, observer and other passes — each with its own price, capacity and deadline. Delegates can't register until at least one product is active."
      actions={
        data.products.length > 0 ? <AddProductButton munId={munId} /> : undefined
      }
    >
      <ProductTable munId={munId} data={data} />
    </WorkspacePage>
  );
}
