/** Mirrors lib/db/schema-enums.ts's `formFieldTypeEnum` (frontend-local, no drizzle import). */
export type FormFieldType =
  | "SHORT_TEXT"
  | "LONG_TEXT"
  | "EMAIL"
  | "PHONE"
  | "NUMBER"
  | "DROPDOWN"
  | "MULTIPLE_CHOICE"
  | "CHECKBOX"
  | "DATE"
  | "FILE_UPLOAD"
  | "INSTITUTION"
  | "ACADEMIC_YEAR"
  | "MUN_EXPERIENCE"
  | "COMMITTEE_PREFERENCE"
  | "PORTFOLIO_PREFERENCE"
  | "EMERGENCY_CONTACT";

export type ConditionalOperator = "EQUALS" | "NOT_EQUALS" | "CONTAINS";

/** A field on a mun's registration form, as returned by GET /muns/:munId/form-fields. */
export interface FormField {
  id: string;
  munId: string;
  fieldKey: string;
  fieldType: FormFieldType;
  label: string;
  helpText: string | null;
  required: boolean;
  choices: string[] | null;
  displayOrder: number;
  conditionalOn: string | null;
  conditionalOperator: ConditionalOperator | null;
  conditionalValue: string | null;
  createdAt: string;
}

/** Body shape for both create and update — every field but fieldKey/fieldType/label is optional on update. */
export interface FormFieldInput {
  fieldKey: string;
  fieldType: FormFieldType;
  label: string;
  helpText?: string | null;
  required?: boolean;
  choices?: string[] | null;
  displayOrder?: number;
  conditionalOn?: string | null;
  conditionalOperator?: ConditionalOperator | null;
  conditionalValue?: string | null;
}

export type UpdateFormFieldInput = Partial<FormFieldInput>;

/** Field types that require a non-empty `choices` array (mirrors CHOICE_FIELD_TYPES in lib/actions/registration-form.ts). */
export const CHOICE_FIELD_TYPES: readonly FormFieldType[] = [
  "DROPDOWN",
  "MULTIPLE_CHOICE",
  "CHECKBOX",
];

export const FORM_FIELD_TYPE_OPTIONS: Array<{ value: FormFieldType; label: string }> = [
  { value: "SHORT_TEXT", label: "Short text" },
  { value: "LONG_TEXT", label: "Long text" },
  { value: "EMAIL", label: "Email" },
  { value: "PHONE", label: "Phone" },
  { value: "NUMBER", label: "Number" },
  { value: "DROPDOWN", label: "Dropdown" },
  { value: "MULTIPLE_CHOICE", label: "Multiple choice" },
  { value: "CHECKBOX", label: "Checkbox" },
  { value: "DATE", label: "Date" },
  { value: "FILE_UPLOAD", label: "File upload" },
  { value: "INSTITUTION", label: "Institution" },
  { value: "ACADEMIC_YEAR", label: "Academic year" },
  { value: "MUN_EXPERIENCE", label: "MUN experience" },
  { value: "COMMITTEE_PREFERENCE", label: "Committee preference" },
  { value: "PORTFOLIO_PREFERENCE", label: "Portfolio preference" },
  { value: "EMERGENCY_CONTACT", label: "Emergency contact" },
];

export const CONDITIONAL_OPERATOR_OPTIONS: Array<{ value: ConditionalOperator; label: string }> = [
  { value: "EQUALS", label: "equals" },
  { value: "NOT_EQUALS", label: "does not equal" },
  { value: "CONTAINS", label: "contains" },
];
