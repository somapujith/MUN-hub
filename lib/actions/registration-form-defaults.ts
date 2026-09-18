import type { FormFieldType } from '@/lib/db/schema-enums'

export interface DefaultRegistrationField {
  fieldKey: string
  fieldType: FormFieldType
  label: string
  helpText: string | null
  required: boolean
  choices: string[] | null
  displayOrder: number
}

/** Core delegate questions shown on every new registration form. */
export const DEFAULT_REGISTRATION_FIELDS: readonly DefaultRegistrationField[] = [
  { fieldKey: 'grade_class', fieldType: 'ACADEMIC_YEAR', label: 'Grade / class', helpText: 'Your current grade, class, or year of study.', required: true, choices: null, displayOrder: 10 },
  { fieldKey: 'residential_address', fieldType: 'LONG_TEXT', label: 'Full residential address', helpText: 'Street, area, city, and pincode.', required: true, choices: null, displayOrder: 11 },
  { fieldKey: 'date_of_birth', fieldType: 'DATE', label: 'Date of birth', helpText: null, required: true, choices: null, displayOrder: 13 },
  { fieldKey: 'referral_code', fieldType: 'SHORT_TEXT', label: 'Referral code', helpText: 'Optional.', required: false, choices: null, displayOrder: 14 },
  { fieldKey: 'emergency_contact_name', fieldType: 'SHORT_TEXT', label: 'Emergency contact name', helpText: 'Parent or guardian name.', required: true, choices: null, displayOrder: 15 },
  { fieldKey: 'emergency_contact_phone', fieldType: 'PHONE', label: 'Emergency contact phone', helpText: 'A 10-digit number.', required: true, choices: null, displayOrder: 16 },
  { fieldKey: 'mun_experience', fieldType: 'MUN_EXPERIENCE', label: 'MUN experience', helpText: 'Conference, committee, portfolio, award, or N/A.', required: false, choices: null, displayOrder: 17 },
]
