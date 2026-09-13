import type { MunModule } from '@/lib/db/schema-enums'

/**
 * Static registry of the 15 PRD Section 38 module keys, generalizing the
 * old hardcoded 4-element `TRACKED_MODULES` array in module-verification.ts.
 *
 * Per design doc Section 2.4: a static code registry, not a DB-configured
 * module list — the eventual `validate` function (Task 9) is code, so the
 * registry can't live purely in the DB anyway. Per-mun overrides of
 * `isRequired` are genuinely data and live on `mun_module_verifications`
 * instead (see `setModuleRequirement` in module-verification.ts).
 *
 * The `validate` field is deliberately NOT part of `ModuleDefinition` yet —
 * that lands in Task 9 so this task stays reviewable in isolation.
 */
export interface ModuleDefinition {
  key: MunModule
  label: string
  defaultRequired: boolean
  phase: 'CONTENT' | 'COMMERCE' | 'OPERATIONS' | 'FINAL'
}

export const MODULE_REGISTRY: ModuleDefinition[] = [
  { key: 'BASIC_INFO', label: 'Basic Info', defaultRequired: true, phase: 'CONTENT' },
  { key: 'DATES_VENUE', label: 'Dates & Venue', defaultRequired: true, phase: 'CONTENT' },
  { key: 'BRANDING', label: 'Branding', defaultRequired: true, phase: 'CONTENT' },
  { key: 'COMMITTEES', label: 'Committees', defaultRequired: true, phase: 'CONTENT' },
  { key: 'PORTFOLIOS', label: 'Portfolios', defaultRequired: true, phase: 'CONTENT' },
  { key: 'EXECUTIVE_BOARD', label: 'Executive Board', defaultRequired: true, phase: 'CONTENT' },
  { key: 'CONTACT', label: 'Contact', defaultRequired: true, phase: 'CONTENT' },

  { key: 'REGISTRATION_TYPES', label: 'Registration Types', defaultRequired: true, phase: 'COMMERCE' },
  { key: 'REGISTRATION_FORM', label: 'Registration Form', defaultRequired: true, phase: 'COMMERCE' },
  { key: 'PRICING_CAPACITY', label: 'Pricing & Capacity', defaultRequired: true, phase: 'COMMERCE' },
  { key: 'PAYMENT_SETTLEMENT', label: 'Payment Settlement', defaultRequired: true, phase: 'COMMERCE' },

  { key: 'RULES_DOCUMENTS', label: 'Rules & Documents', defaultRequired: true, phase: 'OPERATIONS' },
  { key: 'SCHEDULE', label: 'Schedule', defaultRequired: true, phase: 'OPERATIONS' },
  { key: 'ACCOMMODATION', label: 'Accommodation', defaultRequired: true, phase: 'OPERATIONS' },

  { key: 'FINAL_REVIEW', label: 'Final Review', defaultRequired: true, phase: 'FINAL' },
]

/** `MODULE_REGISTRY.map(m => m.key)` — the set of module keys the verification engine tracks. */
export const TRACKED_MODULES: MunModule[] = MODULE_REGISTRY.map((m) => m.key)

/**
 * Looks up a module's static definition. Throws if `key` isn't in the
 * registry — every module key should always resolve; a miss is a real bug
 * (e.g. a legacy pre-PRD key like `mun_details` being passed where a PRD
 * key was expected), not a case to silently paper over.
 */
export function getModuleDefinition(key: MunModule): ModuleDefinition {
  const def = MODULE_REGISTRY.find((m) => m.key === key)
  if (!def) {
    throw new Error(`No ModuleDefinition registered for module key "${key}"`)
  }
  return def
}
