import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { ArrowDown, ArrowUp, Ban, Edit3, Plus, RotateCcw, Tag } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import {
  createRegistrationProduct,
  deactivateRegistrationProduct,
  listRegistrationProducts,
  updateRegistrationProduct,
} from "@/api/registration-products";
import { queryKeys } from "@/api/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/components/shared/currency";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type { RegistrationProduct, RegistrationProductInput } from "@/types/registration-product";

interface ProductFormState {
  name: string;
  price: string;
  currency: string;
  capacity: string;
  deadline: string;
  description: string;
  allowsIndividual: boolean;
  allowsDelegation: boolean;
  displayOrder: number;
}

const EMPTY_FORM: ProductFormState = {
  name: "",
  price: "",
  currency: "INR",
  capacity: "",
  deadline: "",
  description: "",
  allowsIndividual: true,
  allowsDelegation: false,
  displayOrder: 0,
};

/** ISO string -> `<input type="datetime-local">` value, in the viewer's local time. */
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toForm(product: RegistrationProduct): ProductFormState {
  return {
    name: product.name,
    price: String(product.price),
    currency: product.currency,
    capacity: String(product.capacity),
    deadline: toDatetimeLocalValue(product.deadline),
    description: product.description ?? "",
    allowsIndividual: product.allowsIndividual,
    allowsDelegation: product.allowsDelegation,
    displayOrder: product.displayOrder,
  };
}

function toPayload(form: ProductFormState): RegistrationProductInput {
  return {
    name: form.name.trim(),
    price: Number(form.price),
    capacity: Number(form.capacity),
    currency: form.currency.trim() || "INR",
    deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
    description: form.description.trim(),
    allowsIndividual: form.allowsIndividual,
    allowsDelegation: form.allowsDelegation,
    displayOrder: form.displayOrder,
  };
}

export function OrganizerProductsPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RegistrationProduct | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [reordering, setReordering] = useState(false);

  const productsQuery = useQuery({
    queryKey: queryKeys.registrationProducts(munId),
    queryFn: () => listRegistrationProducts(munId),
    enabled: Boolean(munId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.registrationProducts(munId) });

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? updateRegistrationProduct(editing.id, toPayload(form))
        : createRegistrationProduct(munId, toPayload(form)),
    onSuccess: async () => {
      await refresh();
      setIsFormOpen(false);
      setEditing(null);
      toast.success(editing ? "Product updated" : "Product created");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save product"),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (product: RegistrationProduct): Promise<void> => {
      if (product.status === "active") {
        await deactivateRegistrationProduct(product.id);
      } else {
        await updateRegistrationProduct(product.id, { status: "active" });
      }
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to update product status"),
  });

  const products = [...(productsQuery.data ?? [])].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, displayOrder: products.length });
    setIsFormOpen(true);
  };

  const openEdit = (product: RegistrationProduct) => {
    setEditing(product);
    setForm(toForm(product));
    setIsFormOpen(true);
  };

  const move = async (product: RegistrationProduct, direction: -1 | 1) => {
    const index = products.indexOf(product);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= products.length) return;
    const reordered = [...products];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    // Renumber the whole list rather than swapping the two values: products
    // often share a displayOrder (every new product defaults to one), and
    // swapping two equal values changes nothing.
    setReordering(true);
    try {
      for (const [position, item] of reordered.entries()) {
        if (item.displayOrder !== position) {
          await updateRegistrationProduct(item.id, { displayOrder: position });
        }
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Unable to reorder products");
    } finally {
      await refresh();
      setReordering(false);
    }
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return "Name is required";
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) return "Price must be a non-negative number";
    const capacity = Number(form.capacity);
    if (!Number.isFinite(capacity) || capacity < 1) return "Capacity must be at least 1";
    if (!form.allowsIndividual && !form.allowsDelegation) {
      return "At least one of individual or delegation registration must be allowed";
    }
    return null;
  };

  return (
    <>
      <Helmet title="Registration Products" />
      <WorkspacePage
        title="Registration Products"
        description="Registration passes, pricing, capacity, and deadlines."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden /> Add product
          </Button>
        }
      >
        <div className="grid gap-lg xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Registration products" className="flex flex-col gap-md">
            {productsQuery.isLoading && (
              <p className="text-body-md text-muted-foreground">Loading products...</p>
            )}
            {productsQuery.isError && (
              <p className="text-body-md text-destructive">{productsQuery.error.message}</p>
            )}
            {!productsQuery.isLoading && products.length === 0 && (
              <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
                <Tag className="mx-auto size-8 text-muted-foreground" aria-hidden />
                <h2 className="mt-md font-display text-title-sm text-ink">No registration products yet</h2>
                <p className="mt-xs text-body-md text-muted-foreground">
                  Add a delegate or delegation pass so people can register for this conference.
                </p>
                <Button className="mt-lg" size="sm" onClick={openCreate}>
                  <Plus aria-hidden /> Add first product
                </Button>
              </div>
            )}
            {products.map((product, index) => (
              <Card key={product.id} size="sm">
                <CardContent className="flex flex-wrap items-start gap-md">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
                      <h2 className="font-display text-title-sm text-ink">{product.name}</h2>
                      <Badge variant={product.status === "active" ? "success" : "secondary"}>
                        {product.status === "active" ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="mt-xxs text-body-md text-body">
                      {formatPrice(product.price)} {product.currency !== "INR" && product.currency} ·{" "}
                      {product.capacity} seats
                      {product.deadline && ` · Closes ${new Date(product.deadline).toLocaleString()}`}
                    </p>
                    <p className="mt-xs text-caption text-muted-foreground">
                      {[
                        product.allowsIndividual && "Individual",
                        product.allowsDelegation && "Delegation",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No registration mode enabled"}
                    </p>
                    {product.description && (
                      <p className="mt-sm max-w-2xl whitespace-pre-wrap text-body-md leading-relaxed text-body">
                        {product.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-xxs">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Move product up"
                      disabled={index === 0 || reordering}
                      onClick={() => void move(product, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Move product down"
                      disabled={index === products.length - 1 || reordering}
                      onClick={() => void move(product, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit ${product.name}`}
                      onClick={() => openEdit(product)}
                    >
                      <Edit3 aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={product.status === "active" ? `Deactivate ${product.name}` : `Reactivate ${product.name}`}
                      onClick={() => {
                        const verb = product.status === "active" ? "Deactivate" : "Reactivate";
                        if (window.confirm(`${verb} ${product.name}?`)) toggleStatusMutation.mutate(product);
                      }}
                    >
                      {product.status === "active" ? <Ban aria-hidden /> : <RotateCcw aria-hidden />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>

          {isFormOpen && (
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>{editing ? "Edit product" : "Add product"}</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="flex flex-col gap-md"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const error = validate();
                    if (error) {
                      toast.error(error);
                      return;
                    }
                    saveMutation.mutate();
                  }}
                >
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="product-name">Name</Label>
                    <Input
                      id="product-name"
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                      placeholder="e.g. Individual Delegate Pass"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-sm">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="product-price">Price</Label>
                      <Input
                        id="product-price"
                        type="number"
                        min="0"
                        step="1"
                        value={form.price}
                        onChange={(event) => setForm({ ...form, price: event.target.value })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="product-currency">Currency</Label>
                      <Input
                        id="product-currency"
                        value={form.currency}
                        onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
                        maxLength={3}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="product-capacity">Capacity (seats)</Label>
                    <Input
                      id="product-capacity"
                      type="number"
                      min="1"
                      step="1"
                      value={form.capacity}
                      onChange={(event) => setForm({ ...form, capacity: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="product-deadline">Registration deadline</Label>
                    <Input
                      id="product-deadline"
                      type="datetime-local"
                      value={form.deadline}
                      onChange={(event) => setForm({ ...form, deadline: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="product-description">Description</Label>
                    <textarea
                      id="product-description"
                      className="min-h-20 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                      value={form.description}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                      placeholder="What's included with this pass"
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="product-order">Display order</Label>
                    <Input
                      id="product-order"
                      type="number"
                      min="0"
                      value={form.displayOrder}
                      onChange={(event) => setForm({ ...form, displayOrder: Number(event.target.value) || 0 })}
                    />
                  </div>
                  <label className="flex items-center gap-sm text-body-md text-body">
                    <input
                      type="checkbox"
                      checked={form.allowsIndividual}
                      onChange={(event) => setForm({ ...form, allowsIndividual: event.target.checked })}
                    />
                    Allow individual delegate registration
                  </label>
                  <label className="flex items-center gap-sm text-body-md text-body">
                    <input
                      type="checkbox"
                      checked={form.allowsDelegation}
                      onChange={(event) => setForm({ ...form, allowsDelegation: event.target.checked })}
                    />
                    Allow delegation (team) registration
                  </label>
                  <div className="flex justify-end gap-xs">
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsFormOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? "Saving..." : editing ? "Save changes" : "Add product"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </WorkspacePage>
    </>
  );
}
