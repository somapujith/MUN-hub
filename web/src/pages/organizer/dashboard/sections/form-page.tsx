import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { ArrowDown, ArrowUp, Edit3, ListChecks, Plus, Trash2 } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import {
  createFormField,
  deleteFormField,
  listFormFields,
  reorderFormFields,
  updateFormField,
} from "@/api/registration-form";
import { queryKeys } from "@/api/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import {
  CHOICE_FIELD_TYPES,
  CONDITIONAL_OPERATOR_OPTIONS,
  FORM_FIELD_TYPE_OPTIONS,
} from "@/types/registration-form";
import type {
  ConditionalOperator,
  FormField as FormFieldRecord,
  FormFieldInput,
  FormFieldType,
} from "@/types/registration-form";

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** A field key from a label: "Emergency contact name" → "emergency_contact_name". */
function keyFromLabel(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "field";
  const start = /^[a-z]/.test(base) ? base : `field_${base}`;
  let key = start;
  for (let n = 2; taken.has(key); n++) key = `${start}_${n}`;
  return key;
}

interface FormBuilderState {
  fieldKey: string;
  fieldType: FormFieldType;
  label: string;
  helpText: string;
  required: boolean;
  choicesText: string;
  displayOrder: number;
  conditionalOn: string;
  conditionalOperator: ConditionalOperator | "";
  conditionalValue: string;
}

const EMPTY_FORM: FormBuilderState = {
  fieldKey: "",
  fieldType: "SHORT_TEXT",
  label: "",
  helpText: "",
  required: false,
  choicesText: "",
  displayOrder: 0,
  conditionalOn: "",
  conditionalOperator: "",
  conditionalValue: "",
};

function toForm(field: FormFieldRecord): FormBuilderState {
  return {
    fieldKey: field.fieldKey,
    fieldType: field.fieldType,
    label: field.label,
    helpText: field.helpText ?? "",
    required: field.required,
    choicesText: (field.choices ?? []).join(", "),
    displayOrder: field.displayOrder,
    conditionalOn: field.conditionalOn ?? "",
    conditionalOperator: field.conditionalOperator ?? "",
    conditionalValue: field.conditionalValue ?? "",
  };
}

function toPayload(form: FormBuilderState): FormFieldInput {
  const needsChoices = CHOICE_FIELD_TYPES.includes(form.fieldType);
  const choices = needsChoices
    ? form.choicesText
        .split(",")
        .map((choice) => choice.trim())
        .filter(Boolean)
    : null;

  return {
    fieldKey: form.fieldKey.trim(),
    fieldType: form.fieldType,
    label: form.label.trim(),
    helpText: form.helpText.trim() || null,
    required: form.required,
    choices,
    displayOrder: form.displayOrder,
    conditionalOn: form.conditionalOn || null,
    conditionalOperator: form.conditionalOn ? (form.conditionalOperator || "EQUALS") : null,
    conditionalValue: form.conditionalOn ? form.conditionalValue.trim() || null : null,
  };
}

function describeConditional(field: FormFieldRecord, fields: readonly FormFieldRecord[]): string | null {
  if (!field.conditionalOn) return null;
  const operatorLabel =
    CONDITIONAL_OPERATOR_OPTIONS.find((option) => option.value === field.conditionalOperator)?.label ?? "equals";
  const source = fields.find((other) => other.fieldKey === field.conditionalOn)?.label ?? field.conditionalOn;
  return `Shown when "${source}" ${operatorLabel.toLowerCase()} "${field.conditionalValue ?? ""}"`;
}

export function OrganizerFormPage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<FormFieldRecord | null>(null);
  const [form, setForm] = useState<FormBuilderState>(EMPTY_FORM);
  const [isFormOpen, setIsFormOpen] = useState(false);
  // New fields get a key from their label until the organizer types one.
  const [keyEdited, setKeyEdited] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const fieldsQuery = useQuery({
    queryKey: queryKeys.formFields(munId),
    queryFn: () => listFormFields(munId),
    enabled: Boolean(munId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.formFields(munId) });

  const saveMutation = useMutation({
    mutationFn: () =>
      editing ? updateFormField(editing.id, toPayload(form)) : createFormField(munId, toPayload(form)),
    onSuccess: async () => {
      await refresh();
      setIsFormOpen(false);
      setEditing(null);
      toast.success(editing ? "Field updated" : "Field added");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to save field";
      if (/already used on this mun/.test(message)) {
        setAdvancedOpen(true);
        toast.error(`Another field already uses the key "${form.fieldKey.trim()}". Choose a different one under Advanced.`);
        return;
      }
      toast.error(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFormField,
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to delete field"),
  });

  const reorderMutation = useMutation({
    // Uses the dedicated transactional reorder endpoint (validates every id
    // belongs to this mun and swaps both rows in one transaction) rather
    // than two sequential updateFormField calls, which would run full
    // per-field validation (conditional-cycle checks, re-verification
    // triggers) twice for a change that is really one atomic reorder.
    mutationFn: (order: Array<{ id: string; displayOrder: number }>) => reorderFormFields(munId, order),
    onSuccess: refresh,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to reorder fields"),
  });

  const fields = [...(fieldsQuery.data ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);

  const openCreate = () => {
    setEditing(null);
    setKeyEdited(false);
    setAdvancedOpen(false);
    setForm({ ...EMPTY_FORM, displayOrder: fields.length });
    setIsFormOpen(true);
  };

  const openEdit = (field: FormFieldRecord) => {
    setEditing(field);
    setKeyEdited(true);
    setAdvancedOpen(false);
    setForm(toForm(field));
    setIsFormOpen(true);
  };

  const remove = (field: FormFieldRecord) => {
    const dependents = fields.filter((other) => other.conditionalOn === field.fieldKey);
    if (dependents.length > 0) {
      const names = dependents.map((other) => `"${other.label}"`).join(", ");
      toast.error(`"${field.label}" can't be deleted yet: ${names} only show based on it. Change that first.`);
      return;
    }
    if (window.confirm(`Delete "${field.label}"?`)) deleteMutation.mutate(field.id);
  };

  const takenKeys = new Set(fields.map((field) => field.fieldKey));
  const setLabel = (label: string) =>
    setForm((current) => ({
      ...current,
      label,
      fieldKey: editing || keyEdited ? current.fieldKey : keyFromLabel(label, takenKeys),
    }));

  const move = (field: FormFieldRecord, direction: -1 | 1) => {
    const other = fields[fields.indexOf(field) + direction];
    if (!other) return;
    reorderMutation.mutate([
      { id: field.id, displayOrder: other.displayOrder },
      { id: other.id, displayOrder: field.displayOrder },
    ]);
  };

  const requiresChoices = CHOICE_FIELD_TYPES.includes(form.fieldType);
  const conditionalCandidates = fields.filter((field) => field.fieldKey !== (editing?.fieldKey ?? "__none__"));

  const validate = (): string | null => {
    if (!form.label.trim()) return "Label is required";
    if (!FIELD_KEY_PATTERN.test(form.fieldKey.trim())) {
      return "Field key (under Advanced) must start with a lowercase letter and use only lowercase letters, numbers and underscores";
    }
    if (requiresChoices && !form.choicesText.trim()) {
      return `${FORM_FIELD_TYPE_OPTIONS.find((option) => option.value === form.fieldType)?.label} needs at least one choice`;
    }
    if (form.conditionalOn && form.conditionalOn === form.fieldKey.trim()) {
      return "A field cannot be conditional on itself";
    }
    return null;
  };

  return (
    <>
      <Helmet title="Registration Form" />
      <WorkspacePage
        title="Registration Form"
        description="Custom fields delegates fill in during registration."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden /> Add field
          </Button>
        }
      >
        <div className="grid gap-lg xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Registration form fields" className="flex flex-col gap-md">
            {fieldsQuery.isLoading && <p className="text-body-md text-muted-foreground">Loading fields...</p>}
            {fieldsQuery.isError && <p className="text-body-md text-destructive">{fieldsQuery.error.message}</p>}
            {!fieldsQuery.isLoading && fields.length === 0 && (
              <div className="rounded-md border border-dashed border-border px-lg py-xl text-center">
                <ListChecks className="mx-auto size-8 text-muted-foreground" aria-hidden />
                <h2 className="mt-md font-display text-title-sm text-ink">No custom fields yet</h2>
                <p className="mt-xs text-body-md text-muted-foreground">
                  Add fields delegates should fill in when they register.
                </p>
                <Button className="mt-lg" size="sm" onClick={openCreate}>
                  <Plus aria-hidden /> Add first field
                </Button>
              </div>
            )}
            {fields.map((field, index) => {
              const typeLabel = FORM_FIELD_TYPE_OPTIONS.find((option) => option.value === field.fieldType)?.label;
              const conditionalDescription = describeConditional(field, fields);
              return (
                <Card key={field.id} size="sm">
                  <CardContent className="flex flex-wrap items-start gap-md">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
                        <h2 className="font-display text-title-sm text-ink">{field.label}</h2>
                        <Badge variant="outline">{typeLabel}</Badge>
                        {field.required && <Badge variant="warning">Required</Badge>}
                      </div>
                      {field.helpText && <p className="mt-xs text-body-md text-muted-foreground">{field.helpText}</p>}
                      {field.choices && field.choices.length > 0 && (
                        <p className="mt-xs text-caption text-muted-foreground">
                          Choices: {field.choices.join(", ")}
                        </p>
                      )}
                      {conditionalDescription && (
                        <p className="mt-xs text-caption text-link">{conditionalDescription}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-xxs">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Move field up"
                        disabled={index === 0}
                        onClick={() => move(field, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Move field down"
                        disabled={index === fields.length - 1}
                        onClick={() => move(field, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Edit ${field.label}`}
                        onClick={() => openEdit(field)}
                      >
                        <Edit3 aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${field.label}`}
                        onClick={() => remove(field)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </section>

          {isFormOpen && (
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>{editing ? "Edit field" : "Add field"}</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="flex flex-col gap-md"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const error = validate();
                    if (error) {
                      if (error.startsWith("Field key")) setAdvancedOpen(true);
                      toast.error(error);
                      return;
                    }
                    saveMutation.mutate();
                  }}
                >
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="field-label">Label</Label>
                    <Input
                      id="field-label"
                      value={form.label}
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder="e.g. Emergency contact name"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="field-type">Field type</Label>
                    <select
                      id="field-type"
                      className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                      value={form.fieldType}
                      onChange={(event) => setForm({ ...form, fieldType: event.target.value as FormFieldType })}
                    >
                      {FORM_FIELD_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {requiresChoices && (
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="field-choices">Choices (comma-separated)</Label>
                      <textarea
                        id="field-choices"
                        className="min-h-16 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                        value={form.choicesText}
                        onChange={(event) => setForm({ ...form, choicesText: event.target.value })}
                        placeholder="e.g. Yes, No, Not sure"
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="field-help">Help text</Label>
                    <Input
                      id="field-help"
                      value={form.helpText}
                      onChange={(event) => setForm({ ...form, helpText: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="field-conditional-on">Only show when</Label>
                    <select
                      id="field-conditional-on"
                      className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                      value={form.conditionalOn}
                      onChange={(event) => setForm({ ...form, conditionalOn: event.target.value })}
                    >
                      <option value="">Always shown</option>
                      {conditionalCandidates.map((field) => (
                        <option key={field.id} value={field.fieldKey}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {form.conditionalOn && (
                    <div className="grid grid-cols-2 gap-sm">
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="field-conditional-operator">Condition</Label>
                        <select
                          id="field-conditional-operator"
                          className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                          value={form.conditionalOperator}
                          onChange={(event) =>
                            setForm({ ...form, conditionalOperator: event.target.value as ConditionalOperator })
                          }
                        >
                          {CONDITIONAL_OPERATOR_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="field-conditional-value">Value</Label>
                        <Input
                          id="field-conditional-value"
                          value={form.conditionalValue}
                          onChange={(event) => setForm({ ...form, conditionalValue: event.target.value })}
                        />
                      </div>
                    </div>
                  )}
                  <label className="flex items-center gap-sm text-body-md text-body">
                    <input
                      type="checkbox"
                      checked={form.required}
                      onChange={(event) => setForm({ ...form, required: event.target.checked })}
                    />
                    Required
                  </label>
                  <details
                    className="rounded-sm border border-border px-md py-sm"
                    open={advancedOpen}
                    onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
                  >
                    <summary className="cursor-pointer text-body-md font-medium text-ink">Advanced</summary>
                    <div className="mt-sm flex flex-col gap-md">
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="field-key">Field key</Label>
                        <Input
                          id="field-key"
                          value={form.fieldKey}
                          readOnly={Boolean(editing)}
                          onChange={(event) => {
                            setKeyEdited(true);
                            setForm({ ...form, fieldKey: event.target.value });
                          }}
                        />
                        <p className="text-caption text-muted-foreground">
                          {editing
                            ? "The key can't change after a field is added, so earlier answers stay linked to it."
                            : "Filled in from the label. Lowercase letters, numbers and underscores only."}
                        </p>
                      </div>
                      <div className="flex flex-col gap-xs">
                        <Label htmlFor="field-order">Display order</Label>
                        <Input
                          id="field-order"
                          type="number"
                          min="0"
                          value={form.displayOrder}
                          onChange={(event) => setForm({ ...form, displayOrder: Number(event.target.value) || 0 })}
                        />
                        <p className="text-caption text-muted-foreground">
                          Lower numbers come first. The arrows on each field do the same.
                        </p>
                      </div>
                    </div>
                  </details>
                  <div className="flex justify-end gap-xs">
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsFormOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? "Saving..." : editing ? "Save changes" : "Add field"}
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
