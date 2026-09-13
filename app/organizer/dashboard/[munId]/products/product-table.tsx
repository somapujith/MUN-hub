"use client";

import * as React from "react";
import { cn } from "cn";
import { toast } from "sonner";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CalendarOffIcon,
  PencilIcon,
  PlusIcon,
  TagIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProductFormDialog } from "./product-form-dialog";
import { ArchiveProductDialog } from "./archive-product-dialog";
import { restoreProductAction } from "./actions";
import type { ProductRow, ProductsPageData } from "./queries";

/**
 * The Registration Products module body.
 *
 * A client component because it owns three pieces of dialog state that a
 * server component can't hold. It receives fully-resolved rows as props — no
 * fetching happens here — so the server render stays authoritative and
 * `revalidatePath` from the actions is what refreshes the list.
 *
 * LAYOUT: a real table at `lg` and up, stacked cards below. A products list is
 * genuinely tabular (five numeric/short columns that readers compare down the
 * column, not across the row), so a table is the honest markup and gives screen
 * readers the row/column relationships for free. Below `lg` those five columns
 * can't hold their meaning at ~90px each, so the same data reflows to cards —
 * rendered from the same array, never duplicated in the DOM (no
 * `hidden lg:block` twin, which would double the a11y tree).
 */

interface ProductTableProps {
  munId: string;
  data: ProductsPageData;
}

export function ProductTable({ munId, data }: ProductTableProps) {
  // `null` = closed, `"new"` = create, a ProductRow = edit that product.
  const [formTarget, setFormTarget] = React.useState<ProductRow | "new" | null>(
    null,
  );
  const [archiveTarget, setArchiveTarget] = React.useState<ProductRow | null>(
    null,
  );
  const [restoringId, setRestoringId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  function handleRestore(product: ProductRow) {
    setRestoringId(product.id);
    startTransition(async () => {
      const result = await restoreProductAction(munId, product.id);
      setRestoringId(null);

      if (!result.ok) {
        toast.error(`Could not restore ${product.name}`, {
          description: result.error,
        });
        return;
      }
      toast.success(`${product.name} restored`, {
        description: "Back on sale on the registration page.",
      });
    });
  }

  const { products, totals } = data;

  return (
    <div className="flex flex-col gap-lg">
      <SummaryStrip totals={totals} />

      {products.length === 0 ? (
        <EmptyState onCreate={() => setFormTarget("new")} />
      ) : (
        <>
          <ProductTableDesktop
            products={products}
            restoringId={restoringId}
            onEdit={setFormTarget}
            onArchive={setArchiveTarget}
            onRestore={handleRestore}
          />
          <ProductCardList
            products={products}
            restoringId={restoringId}
            onEdit={setFormTarget}
            onArchive={setArchiveTarget}
            onRestore={handleRestore}
          />
        </>
      )}

      {/*
        One dialog instance for both create and edit. `product` is undefined in
        create mode; the dialog keys its fields on the product id so switching
        targets refreshes the uncontrolled defaults.
      */}
      <ProductFormDialog
        munId={munId}
        product={formTarget === "new" ? undefined : (formTarget ?? undefined)}
        open={formTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
      />

      <ArchiveProductDialog
        munId={munId}
        product={archiveTarget}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      />
    </div>
  );
}

/**
 * Exposed so the page header's primary action can open the same create dialog
 * the empty state does. The header lives in a server component
 * (`<WorkspacePage actions>`), so it needs its own client trigger rather than
 * reaching into this component's state.
 */
export function AddProductButton({ munId }: { munId: string }) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        Add product
      </Button>
      <ProductFormDialog munId={munId} open={open} onOpenChange={setOpen} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryStrip({ totals }: { totals: ProductsPageData["totals"] }) {
  /*
    A sold seat must never read as "0%". 1 of 220 rounds to zero, which is
    indistinguishable from having sold nothing — the one number an organizer
    would act on. Floor any non-zero share at "<1%" instead.
  */
  const utilisation = formatUtilisation(totals.taken, totals.capacity);

  const stats = [
    { label: "Active products", value: String(totals.activeCount) },
    { label: "Total seats", value: totals.capacity.toLocaleString("en-IN") },
    { label: "Seats taken", value: totals.taken.toLocaleString("en-IN") },
    { label: "Seats left", value: totals.available.toLocaleString("en-IN") },
    { label: "Utilisation", value: utilisation },
  ];

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={cn(
            "flex flex-col gap-xxs bg-background px-md py-sm dark:bg-card",
            // Five stats into a 2- or 3-column grid leaves a dead cell on the
            // last row that reads as a missing stat. The final item spans it.
            index === stats.length - 1 &&
              "col-span-2 sm:col-span-1 lg:col-span-1",
          )}
        >
          <dt className="text-[12px] leading-[1.35] font-medium tracking-[0.16px] text-muted-foreground">
            {stat.label}
          </dt>
          <dd className="font-display text-title-md tabular-nums text-ink">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Desktop table
// ---------------------------------------------------------------------------

interface ListProps {
  products: ProductRow[];
  restoringId: string | null;
  onEdit: (product: ProductRow) => void;
  onArchive: (product: ProductRow) => void;
  onRestore: (product: ProductRow) => void;
}

const headerCell =
  "px-md py-sm text-left text-[12px] leading-[1.35] font-medium tracking-[0.16px] text-muted-foreground";

function ProductTableDesktop({
  products,
  restoringId,
  onEdit,
  onArchive,
  onRestore,
}: ListProps) {
  return (
    <div className="hidden overflow-hidden rounded-md border border-border lg:block">
      <table className="w-full border-collapse text-body-md">
        <caption className="sr-only">
          Registration products for this conference, with price, seat
          availability and deadline.
        </caption>
        <thead className="bg-surface-soft dark:bg-muted/40">
          <tr>
            <th scope="col" className={headerCell}>
              Product
            </th>
            <th scope="col" className={cn(headerCell, "text-right")}>
              Price
            </th>
            <th scope="col" className={cn(headerCell, "w-[16rem]")}>
              Seats
            </th>
            <th scope="col" className={headerCell}>
              Deadline
            </th>
            {/* Wide enough for Edit + Archive on one line — at 11rem they wrapped. */}
            <th scope="col" className={cn(headerCell, "w-[15rem] text-right")}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const archived = product.status !== "active";
            return (
              <tr
                key={product.id}
                className={cn(
                  "border-t border-border transition-colors hover:bg-surface-soft dark:hover:bg-muted/30",
                  archived && "bg-surface-soft/60 dark:bg-muted/20",
                )}
              >
                <th scope="row" className="px-md py-sm text-left font-normal">
                  <div className="flex flex-col gap-xxs">
                    <span
                      className={cn(
                        "font-medium text-ink",
                        archived && "text-muted-foreground line-through",
                      )}
                    >
                      {product.name}
                    </span>
                    {archived && (
                      <Badge variant="secondary" className="w-fit">
                        Archived
                      </Badge>
                    )}
                  </div>
                </th>
                <td className="px-md py-sm text-right tabular-nums text-ink">
                  {formatPrice(product.price, product.currency)}
                </td>
                <td className="px-md py-sm">
                  <SeatMeter product={product} />
                </td>
                <td className="px-md py-sm">
                  <DeadlineCell deadline={product.deadline} />
                </td>
                <td className="px-md py-sm whitespace-nowrap">
                  <RowActions
                    product={product}
                    restoring={restoringId === product.id}
                    onEdit={onEdit}
                    onArchive={onArchive}
                    onRestore={onRestore}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile / tablet cards
// ---------------------------------------------------------------------------

function ProductCardList({
  products,
  restoringId,
  onEdit,
  onArchive,
  onRestore,
}: ListProps) {
  return (
    <ul className="flex flex-col gap-sm lg:hidden">
      {products.map((product) => {
        const archived = product.status !== "active";
        return (
          <li
            key={product.id}
            className={cn(
              "flex flex-col gap-sm rounded-md border border-border bg-background p-md transition-colors dark:bg-card",
              archived && "bg-surface-soft/60 dark:bg-muted/20",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-xs">
              <div className="flex min-w-0 flex-col gap-xxs">
                <span
                  className={cn(
                    "font-display text-title-sm text-ink",
                    archived && "text-muted-foreground line-through",
                  )}
                >
                  {product.name}
                </span>
                <DeadlineCell deadline={product.deadline} />
              </div>
              <div className="flex flex-col items-end gap-xxs">
                <span className="font-display text-title-sm tabular-nums text-ink">
                  {formatPrice(product.price, product.currency)}
                </span>
                {archived && <Badge variant="secondary">Archived</Badge>}
              </div>
            </div>

            <SeatMeter product={product} />

            <RowActions
              product={product}
              restoring={restoringId === product.id}
              onEdit={onEdit}
              onArchive={onArchive}
              onRestore={onRestore}
            />
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * Seat availability, three-channel: a bar (position), a ratio (number) and a
 * colour. Colour alone would fail for the ~8% of men with a red/green
 * deficiency, and a bar alone can't tell 190/200 from 195/200.
 */
function SeatMeter({ product }: { product: ProductRow }) {
  const { capacity, taken, available } = product;
  const pct = capacity > 0 ? Math.min((taken / capacity) * 100, 100) : 0;
  const full = available === 0 && capacity > 0;
  const tight = !full && capacity > 0 && available / capacity <= 0.1;

  return (
    <div className="flex min-w-0 flex-col gap-xxs">
      <div className="flex items-baseline justify-between gap-xs tabular-nums">
        <span className="text-body-md text-ink">
          {taken.toLocaleString("en-IN")}
          <span className="text-muted-foreground">
            {" / "}
            {capacity.toLocaleString("en-IN")}
          </span>
        </span>
        <span
          className={cn(
            "text-[12px] leading-[1.35] font-medium tracking-[0.16px]",
            full
              ? "text-destructive-text"
              : tight
                ? "text-warning-text"
                : "text-muted-foreground",
          )}
        >
          {full ? "Full" : `${available.toLocaleString("en-IN")} left`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={taken}
        aria-label={`${taken} of ${capacity} seats taken`}
        className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-strong dark:bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-pill transition-[width] duration-300 ease-out motion-reduce:transition-none",
            full ? "bg-destructive" : tight ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DeadlineCell({ deadline }: { deadline: Date | null }) {
  if (!deadline) {
    return (
      <span className="inline-flex items-center gap-xxs text-body-md text-muted-foreground">
        <CalendarOffIcon aria-hidden className="size-3.5" strokeWidth={1.5} />
        No deadline
      </span>
    );
  }

  const past = deadline.getTime() < Date.now();

  return (
    <span
      className={cn(
        "text-body-md tabular-nums",
        past ? "text-destructive-text" : "text-body dark:text-muted-foreground",
      )}
    >
      <time dateTime={deadline.toISOString()}>
        {deadline.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </time>
      {past && <span className="ml-xxs font-medium">· closed</span>}
    </span>
  );
}

interface RowActionsProps {
  product: ProductRow;
  restoring: boolean;
  onEdit: (product: ProductRow) => void;
  onArchive: (product: ProductRow) => void;
  onRestore: (product: ProductRow) => void;
}

function RowActions({
  product,
  restoring,
  onEdit,
  onArchive,
  onRestore,
}: RowActionsProps) {
  const archived = product.status !== "active";

  return (
    <div className="flex flex-wrap items-center justify-end gap-xs">
      <Button size="sm" variant="outline" onClick={() => onEdit(product)}>
        <PencilIcon aria-hidden />
        Edit
        <span className="sr-only"> {product.name}</span>
      </Button>

      {archived ? (
        <Button
          size="sm"
          variant="outline"
          disabled={restoring}
          onClick={() => onRestore(product)}
        >
          <ArchiveRestoreIcon aria-hidden />
          {restoring ? "Restoring…" : "Restore"}
          <span className="sr-only"> {product.name}</span>
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onArchive(product)}
          /*
            Kept as `outline`, not `destructive`: a table row with a solid red
            button on every line reads as an alarm state. The destructive
            framing belongs in the confirm dialog, where the consequence is
            actually being decided.
          */
        >
          <ArchiveIcon aria-hidden />
          Archive
          <span className="sr-only"> {product.name}</span>
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-md rounded-md border border-dashed border-border bg-surface-soft px-lg py-xxl text-center dark:bg-card">
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-surface-strong text-muted-foreground dark:bg-muted"
      >
        <TagIcon strokeWidth={1.5} className="size-5" />
      </span>
      <div className="flex max-w-prose flex-col gap-xs">
        <p className="font-display text-title-sm text-ink">
          No registration products yet
        </p>
        <p className="text-body-md text-pretty text-body dark:text-muted-foreground">
          Nobody can register until at least one pass exists. Most conferences
          start with a single Delegate pass and add Press or Observer later.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <PlusIcon aria-hidden />
        Create your first product
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatUtilisation(taken: number, capacity: number): string {
  if (capacity === 0) return "—";
  if (taken === 0) return "0%";
  const pct = (taken / capacity) * 100;
  if (pct < 1) return "<1%";
  if (pct > 99 && taken < capacity) return ">99%";
  return `${Math.round(pct)}%`;
}

function formatPrice(price: number, currency: string): string {
  if (price === 0) return "Free";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    // An unrecognised ISO code makes Intl throw rather than degrade. A product
    // row is not worth a crashed page.
    return `${currency} ${price.toLocaleString("en-IN")}`;
  }
}
