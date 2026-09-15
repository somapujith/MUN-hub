"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetupTextarea } from "../setup/setup-field";
import { addFormFieldAction, deleteFormFieldAction } from "./actions";
import type { FormField } from "@/lib/actions/registration-form";

const TYPES = [
  ["SHORT_TEXT", "Short text"], ["LONG_TEXT", "Long text"], ["EMAIL", "Email"],
  ["PHONE", "Phone number"], ["DATE", "Date"], ["DROPDOWN", "Dropdown"],
  ["MULTIPLE_CHOICE", "Multiple choice"], ["CHECKBOX", "Checkboxes"],
] as const;

function SaveButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Adding…" : <><PlusIcon aria-hidden /> Add field</>}</Button>;
}

export function FormBuilder({ munId, fields }: { munId: string; fields: FormField[] }) {
  const [state, formAction] = useFormState(addFormFieldAction.bind(null, munId), {} as { error?: string; success?: string });
  return <div className="flex flex-col gap-xl">
    <form action={formAction} className="flex flex-col gap-lg rounded-md border border-border bg-surface-soft p-lg" noValidate>
      <div><h2 className="font-display text-title-sm text-ink">Add a field</h2><p className="text-body-md text-muted-foreground">Extend the default delegate form with questions specific to your conference.</p></div>
      <div className="grid gap-lg sm:grid-cols-2">
        <div className="flex flex-col gap-xs"><Label htmlFor="fieldKey">Field key</Label><Input id="fieldKey" name="fieldKey" placeholder="dietary_requirements" required /><p className="text-body-sm text-muted-foreground">Letters, numbers, and underscores.</p></div>
        <div className="flex flex-col gap-xs"><Label htmlFor="label">Question label</Label><Input id="label" name="label" placeholder="Dietary requirements" required /></div>
        <div className="flex flex-col gap-xs"><Label htmlFor="fieldType">Answer type</Label><select id="fieldType" name="fieldType" className="h-10 rounded-sm border border-input bg-background px-md text-body-md">{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="flex items-center gap-sm pt-lg"><input id="required" name="required" type="checkbox" /><Label htmlFor="required">Required field</Label></div>
      </div>
      <div className="flex flex-col gap-xs"><Label htmlFor="helpText">Help text</Label><Input id="helpText" name="helpText" placeholder="Tell delegates how to answer." /></div>
      <div className="flex flex-col gap-xs"><Label htmlFor="choices">Choices</Label><SetupTextarea id="choices" name="choices" rows={3} placeholder="One choice per line. Used for dropdowns, multiple choice, and checkboxes." /></div>
      {state.error && <p role="alert" className="text-body-md text-destructive-text">{state.error}</p>}{state.success && <p className="text-body-md text-success-text">{state.success}</p>}
      <div className="flex justify-end"><SaveButton /></div>
    </form>
    <div className="flex flex-col gap-sm"><h2 className="font-display text-title-sm text-ink">Delegate form fields</h2>{fields.map((field) => <FieldRow key={field.id} munId={munId} field={field} />)}</div>
  </div>;
}

function FieldRow({ munId, field }: { munId: string; field: FormField }) {
  const [state, action] = React.useActionState(deleteFormFieldAction.bind(null, munId, field.id), {} as { error?: string; success?: string });
  const isDefault = ["grade_class", "residential_address", "transportation", "date_of_birth", "referral_code", "emergency_contact_name", "emergency_contact_phone", "mun_experience", "institution_name"].includes(field.fieldKey);
  return <div className="flex items-center justify-between gap-md rounded-md border border-border p-md"><div><p className="text-body-md font-medium text-ink">{field.label}{field.required && <span className="text-primary"> *</span>}</p><p className="text-body-sm text-muted-foreground">{field.fieldType.replaceAll("_", " ").toLowerCase()} · {isDefault ? "Default field" : field.fieldKey}</p></div>{!isDefault && <form action={action}><Button type="submit" variant="ghost" size="icon" aria-label={`Delete ${field.label}`}><Trash2Icon aria-hidden /></Button>{state.error && <span className="text-body-sm text-destructive-text">{state.error}</span>}</form>}</div>;
}
