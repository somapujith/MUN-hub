export type AccommodationFieldType = "TEXT" | "NUMBER" | "DATE" | "DROPDOWN" | "CHECKBOX";

export interface AccommodationOption {
  id: string;
  munId: string;
  name: string;
  price: number;
  capacity: number;
  description: string | null;
  status: string;
  createdAt: string;
}

export interface CreateAccommodationOptionInput {
  name: string;
  price: number;
  capacity: number;
  description?: string;
}

export interface UpdateAccommodationOptionInput {
  name?: string;
  price?: number;
  capacity?: number;
  description?: string | null;
  status?: string;
}

export interface AccommodationOptionField {
  id: string;
  optionId: string;
  fieldType: AccommodationFieldType;
  label: string;
  required: boolean;
  choices: string[] | null;
  displayOrder: number;
}

export interface CreateAccommodationOptionFieldInput {
  fieldType: AccommodationFieldType;
  label: string;
  required?: boolean;
  choices?: string[];
  displayOrder?: number;
}

export interface UpdateAccommodationOptionFieldInput {
  fieldType?: AccommodationFieldType;
  label?: string;
  required?: boolean;
  choices?: string[] | null;
  displayOrder?: number;
}
