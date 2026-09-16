import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { BedDouble, Edit3, ListPlus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import {
  createAccommodationOption,
  createAccommodationOptionField,
  deleteAccommodationOption,
  deleteAccommodationOptionField,
  listAccommodationOptionFields,
  listAccommodationOptions,
  updateAccommodationOption,
  updateAccommodationOptionField,
} from "@/api/accommodation";
import { queryKeys } from "@/api/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/components/shared/currency";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type {
  AccommodationFieldType,
  AccommodationOption,
  AccommodationOptionField,
  CreateAccommodationOptionFieldInput,
  CreateAccommodationOptionInput,
} from "@/types/accommodation";

const FIELD_TYPE_OPTIONS: Array<{ value: AccommodationFieldType; label: string }> = [
  { value: "TEXT", label: "Text" },
  { value: "NUMBER", label: "Number" },
  { value: "DATE", label: "Date" },
  { value: "DROPDOWN", label: "Dropdown" },
  { value: "CHECKBOX", label: "Checkbox" },
];

const EMPTY_OPTION_FORM: CreateAccommodationOptionInput = {
  name: "",
  price: 0,
  capacity: 1,
  description: "",
};

function toOptionForm(option: AccommodationOption): CreateAccommodationOptionInput {
  return {
    name: option.name,
    price: option.price,
    capacity: option.capacity,
    description: option.description ?? "",
  };
}

const EMPTY_FIELD_FORM: CreateAccommodationOptionFieldInput = {
  fieldType: "TEXT",
  label: "",
  required: false,
  choices: [],
  displayOrder: 0,
};

/** Nested fields manager for one accommodation option — collapsed by default, matches the executive-board page's inline-form density. */
function AccommodationFieldsPanel({ optionId }: { optionId: string }) {
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccommodationOptionField | null>(null);
  const [form, setForm] = useState<CreateAccommodationOptionFieldInput>(EMPTY_FIELD_FORM);

  const fieldsQuery = useQuery({
    queryKey: queryKeys.accommodationOptionFields(optionId),
    queryFn: () => listAccommodationOptionFields(optionId),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.accommodationOptionFields(optionId) });

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? updateAccommodationOptionField(editing.id, form)
        : createAccommodationOptionField(optionId, form),
    onSuccess: async () => {
      await refresh();
      setIsFormOpen(false);
      setEditing(null);
      toast.success(editing ? "Field updated" : "Field added");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save field"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccommodationOptionField,
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to delete field"),
  });

  const fields = fieldsQuery.data ?? [];
  const needsChoices = form.fieldType === "DROPDOWN" || form.fieldType === "CHECKBOX";

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FIELD_FORM, displayOrder: fields.length });
    setIsFormOpen(true);
  };
  const openEdit = (field: AccommodationOptionField) => {
    setEditing(field);
    setForm({
      fieldType: field.fieldType,
      label: field.label,
      required: field.required,
      choices: field.choices ?? [],
      displayOrder: field.displayOrder,
    });
    setIsFormOpen(true);
  };

  return (
    <div className="mt-md flex flex-col gap-sm border-t border-border pt-md">
      <div className="flex items-center justify-between gap-sm">
        <h3 className="text-label-md font-medium text-ink">Custom fields for this option</h3>
        {!isFormOpen && (
          <Button type="button" variant="outline" size="xs" onClick={openCreate}>
            <ListPlus aria-hidden /> Add field
          </Button>
        )}
      </div>
      {fieldsQuery.isLoading && <p className="text-body-md text-muted-foreground">Loading fields...</p>}
      {fields.length === 0 && !fieldsQuery.isLoading && (
        <p className="text-body-md text-muted-foreground">
          No custom fields — delegates will only see the base option.
        </p>
      )}
      {fields.length > 0 && (
        <ul className="flex flex-col gap-xs">
          {fields.map((field) => (
            <li
              key={field.id}
              className="flex flex-wrap items-center justify-between gap-xs rounded-sm border border-border bg-surface-soft/40 px-sm py-xs"
            >
              <span className="text-body-md text-body">
                {field.label}{" "}
                <span className="text-caption text-muted-foreground">
                  ({FIELD_TYPE_OPTIONS.find((option) => option.value === field.fieldType)?.label}
                  {field.required ? ", required" : ""})
                </span>
              </span>
              <div className="flex items-center gap-xxs">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Edit ${field.label}`}
                  onClick={() => openEdit(field)}
                >
                  <Edit3 aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete ${field.label}`}
                  onClick={() => {
                    if (window.confirm(`Delete field "${field.label}"?`)) deleteMutation.mutate(field.id);
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {isFormOpen && (
        <form
          className="flex flex-col gap-sm rounded-sm border border-border bg-surface-soft/40 p-sm"
          onSubmit={(event) => {
            event.preventDefault();
            if (!form.label.trim()) {
              toast.error("Field label is required");
              return;
            }
            if (needsChoices && (!form.choices || form.choices.length === 0)) {
              toast.error("Dropdown/checkbox fields need at least one choice");
              return;
            }
            saveMutation.mutate();
          }}
        >
          <div className="grid gap-sm sm:grid-cols-2">
            <div className="flex flex-col gap-xxs">
              <Label htmlFor={`field-label-${optionId}`}>Label</Label>
              <Input
                id={`field-label-${optionId}`}
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-xxs">
              <Label htmlFor={`field-type-${optionId}`}>Type</Label>
              <select
                id={`field-type-${optionId}`}
                className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                value={form.fieldType}
                onChange={(event) =>
                  setForm({ ...form, fieldType: event.target.value as AccommodationFieldType })
                }
              >
                {FIELD_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {needsChoices && (
            <div className="flex flex-col gap-xxs">
              <Label htmlFor={`field-choices-${optionId}`}>Choices (comma separated)</Label>
              <Input
                id={`field-choices-${optionId}`}
                value={(form.choices ?? []).join(", ")}
                onChange={(event) =>
                  setForm({
                    ...form,
                    choices: event.target.value
                      .split(",")
                      .map((choice) => choice.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          )}
          <label className="flex items-center gap-sm text-body-md text-body">
            <input
              type="checkbox"
              checked={form.required ?? false}
              onChange={(event) => setForm({ ...form, required: event.target.checked })}
            />
            Required
          </label>
          <div className="flex justify-end gap-xs">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                setIsFormOpen(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="xs" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : editing ? "Save field" : "Add field"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function OrganizerAccommodationPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AccommodationOption | null>(null);
  const [form, setForm] = useState<CreateAccommodationOptionInput>(EMPTY_OPTION_FORM);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);

  const optionsQuery = useQuery({
    queryKey: queryKeys.accommodationOptions(munId),
    queryFn: () => listAccommodationOptions(munId),
    enabled: Boolean(munId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.accommodationOptions(munId) });

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? updateAccommodationOption(editing.id, form)
        : createAccommodationOption(munId, form),
    onSuccess: async () => {
      await refresh();
      setIsFormOpen(false);
      setEditing(null);
      toast.success(editing ? "Accommodation option updated" : "Accommodation option added");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save option"),
  });

  const archiveMutation = useMutation({
    mutationFn: deleteAccommodationOption,
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to archive option"),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => updateAccommodationOption(id, { status: "active" }),
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to restore option"),
  });

  const options = optionsQuery.data ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_OPTION_FORM);
    setIsFormOpen(true);
  };
  const openEdit = (option: AccommodationOption) => {
    setEditing(option);
    setForm(toOptionForm(option));
    setIsFormOpen(true);
  };

  return (
    <>
      <Helmet title="Accommodation" />
      <WorkspacePage
        title="Accommodation"
        description="Paid add-ons and lodging options sold alongside registration."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden /> Add option
          </Button>
        }
      >
        <div className="grid gap-lg xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Accommodation options" className="flex flex-col gap-md">
            {optionsQuery.isLoading && (
              <p className="text-body-md text-muted-foreground">Loading accommodation options...</p>
            )}
            {optionsQuery.isError && (
              <p className="text-body-md text-destructive">{optionsQuery.error.message}</p>
            )}
            {!optionsQuery.isLoading && options.length === 0 && (
              <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
                <BedDouble className="mx-auto size-8 text-muted-foreground" aria-hidden />
                <h2 className="mt-md font-display text-title-sm text-ink">No accommodation options yet</h2>
                <p className="mt-xs text-body-md text-muted-foreground">
                  Add lodging or add-on packages delegates can purchase alongside registration.
                </p>
                <Button className="mt-lg" size="sm" onClick={openCreate}>
                  <Plus aria-hidden /> Add first option
                </Button>
              </div>
            )}
            {options.map((option) => {
              const isInactive = option.status !== "active";
              const isExpanded = expandedOptionId === option.id;
              return (
                <Card key={option.id} size="sm">
                  <CardContent>
                    <div className="flex flex-wrap items-start justify-between gap-md">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
                          <h2 className="font-display text-title-sm text-ink">{option.name}</h2>
                          {isInactive && (
                            <span className="rounded-full bg-surface-soft px-xs py-px text-caption text-muted-foreground">
                              Archived
                            </span>
                          )}
                        </div>
                        <p className="mt-xxs text-body-md text-body">
                          {formatPrice(option.price)} · Capacity {option.capacity}
                        </p>
                        {option.description && (
                          <p className="mt-sm max-w-2xl whitespace-pre-wrap text-body-md leading-relaxed text-body">
                            {option.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-xxs">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Edit ${option.name}`}
                          onClick={() => openEdit(option)}
                        >
                          <Edit3 aria-hidden />
                        </Button>
                        {isInactive ? (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Restore ${option.name}`}
                            onClick={() => restoreMutation.mutate(option.id)}
                          >
                            <RotateCcw aria-hidden />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Archive ${option.name}`}
                            onClick={() => {
                              if (window.confirm(`Archive "${option.name}"? Existing registrations keep it.`)) {
                                archiveMutation.mutate(option.id);
                              }
                            }}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-sm">
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        className="px-0"
                        onClick={() => setExpandedOptionId(isExpanded ? null : option.id)}
                      >
                        {isExpanded ? (
                          <>
                            <X aria-hidden /> Hide custom fields
                          </>
                        ) : (
                          <>
                            <ListPlus aria-hidden /> Manage custom fields
                          </>
                        )}
                      </Button>
                    </div>
                    {isExpanded && <AccommodationFieldsPanel optionId={option.id} />}
                  </CardContent>
                </Card>
              );
            })}
          </section>
          {isFormOpen && (
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>{editing ? "Edit accommodation option" : "Add accommodation option"}</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="flex flex-col gap-md"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!form.name.trim()) {
                      toast.error("Name is required");
                      return;
                    }
                    if (form.price < 0 || form.capacity < 1) {
                      toast.error("Price must be 0 or more and capacity at least 1");
                      return;
                    }
                    saveMutation.mutate();
                  }}
                >
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="acc-name">Name</Label>
                    <Input
                      id="acc-name"
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="acc-price">Price (INR)</Label>
                    <Input
                      id="acc-price"
                      type="number"
                      min="0"
                      value={form.price}
                      onChange={(event) => setForm({ ...form, price: Number(event.target.value) || 0 })}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="acc-capacity">Capacity</Label>
                    <Input
                      id="acc-capacity"
                      type="number"
                      min="1"
                      value={form.capacity}
                      onChange={(event) => setForm({ ...form, capacity: Number(event.target.value) || 1 })}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="acc-description">Description</Label>
                    <textarea
                      id="acc-description"
                      className="min-h-24 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                      value={form.description ?? ""}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                    />
                  </div>
                  <div className="flex justify-end gap-xs">
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsFormOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? "Saving..." : editing ? "Save changes" : "Add option"}
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
